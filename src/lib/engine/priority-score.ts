import { differenceInCalendarDays, parseISO } from "date-fns";
import type { Order, ProductionLine, Style } from "../types";
import { STAGE_ORDER, stagesForRoute } from "../types";
import { estimateLineMinutes } from "./capacity";
import { curveParamsForComplexity } from "./complexity";
import { effectiveRmDate } from "./material-gate";

/**
 * Daily priority scoring, including Critical Ratio.
 *
 * CR is a single-machine dispatching rule and misbehaves if used naively:
 *
 *  - Once an order is past due the numerator goes negative, so sorting by CR
 *    puts the *most hopeless* job first and starves jobs that are still
 *    recoverable. Orders below CR_UNRECOVERABLE are therefore moved into a
 *    separate bucket and leave the sequencing race entirely.
 *  - CR explodes as remaining lead time approaches zero, which causes violent
 *    reordering right at the end of a run. The denominator is floored.
 *  - CR is defined per order, but this is a multi-stage flow shop. It is one
 *    weighted input to the score here, never the sort key on its own.
 */

/** Denominator floor, in days, so CR cannot blow up near completion. */
export const MIN_LEAD_DAYS = 0.5;

/** Below this CR an order cannot realistically be recovered by resequencing. */
export const CR_UNRECOVERABLE = 0.35;

/** Urgency is capped so one desperate order cannot dominate the whole score. */
export const CR_FLOOR = 0.1;

/** Lead-time inflation covering the learning ramp on a fresh style. */
export const RAMP_ALLOWANCE = 0.15;

const WEIGHT_URGENCY = 1.0;
const WEIGHT_PLANNER = 0.6;
const RM_NOT_READY_PENALTY = 2.0;

export type PriorityBucket = "critical" | "normal" | "replan_delivery";

export interface OrderPriority {
  orderId: string;
  criticalRatio: number;
  bucket: PriorityBucket;
  /** Higher schedules sooner. */
  score: number;
  remainingLeadDays: number;
  daysUntilDue: number;
  slackDays: number;
  rmReady: boolean;
}

export interface PriorityInput {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  /** Defaults to today. */
  today?: string;
  applyRmBuffer?: boolean;
}

/**
 * Days of work left across all remaining stages, assuming the stage's full line
 * pool is available. Inflated by a ramp allowance because a fresh style does
 * not start at target efficiency.
 */
export function estimateRemainingLeadTime(
  order: Order,
  style: Style,
  lines: ProductionLine[]
): number {
  let days = 0;
  const route = stagesForRoute(style.routeId);

  for (const stage of STAGE_ORDER) {
    if (!route.includes(stage)) continue;
    const stageLines = lines.filter((l) => l.stage === stage);
    if (stageLines.length === 0) continue;

    const totalOperators = stageLines.reduce((s, l) => s + l.operators, 0);
    const avgEfficiency =
      stageLines.reduce((s, l) => s + l.efficiencyBaseline, 0) /
      stageLines.length;
    const shiftMinutes = Math.max(
      ...stageLines.map((l) => l.shiftMinutes)
    );

    const minutes = estimateLineMinutes(
      order.quantity,
      style.smv[stage],
      totalOperators,
      avgEfficiency,
      order.packingType,
      stage
    );
    days += minutes / Math.max(1, shiftMinutes);
  }

  // Complex styles spend longer below target efficiency, so they need more
  // calendar time than the flat SMV maths suggests.
  const curve = curveParamsForComplexity(style.complexity);
  const rampPenalty = RAMP_ALLOWANCE * (1 - curve.start) * 2;

  return days * (1 + rampPenalty);
}

export function scoreOrderPriority(
  order: Order,
  style: Style,
  lines: ProductionLine[],
  today: string,
  applyRmBuffer = true
): OrderPriority {
  const remainingLeadDays = estimateRemainingLeadTime(order, style, lines);
  const daysUntilDue = differenceInCalendarDays(
    parseISO(order.deliveryDeadline),
    parseISO(today)
  );

  const criticalRatio =
    daysUntilDue / Math.max(remainingLeadDays, MIN_LEAD_DAYS);

  const gateDate = effectiveRmDate(order, applyRmBuffer);
  const rmReady = gateDate <= today;

  const bucket: PriorityBucket =
    criticalRatio < CR_UNRECOVERABLE
      ? "replan_delivery"
      : criticalRatio < 1
        ? "critical"
        : "normal";

  const urgency = 1 / Math.max(criticalRatio, CR_FLOOR);
  const plannerBoost = (100 - Math.min(100, order.priority)) / 100;

  const score =
    WEIGHT_URGENCY * urgency +
    WEIGHT_PLANNER * plannerBoost -
    (rmReady ? 0 : RM_NOT_READY_PENALTY);

  return {
    orderId: order.id,
    criticalRatio: Math.round(criticalRatio * 1000) / 1000,
    bucket,
    score: Math.round(score * 1000) / 1000,
    remainingLeadDays: Math.round(remainingLeadDays * 100) / 100,
    daysUntilDue,
    slackDays: Math.round((daysUntilDue - remainingLeadDays) * 100) / 100,
    rmReady,
  };
}

export function scoreAllPriorities(input: PriorityInput): OrderPriority[] {
  const today = input.today ?? new Date().toISOString().split("T")[0]!;
  const applyRmBuffer = input.applyRmBuffer ?? true;
  const styleMap = new Map(input.styles.map((s) => [s.id, s]));

  const scored: OrderPriority[] = [];
  for (const order of input.orders) {
    const style = styleMap.get(order.styleId);
    if (!style) continue;
    scored.push(
      scoreOrderPriority(order, style, input.lines, today, applyRmBuffer)
    );
  }
  return scored;
}

/**
 * Sequence by blended priority. Unrecoverable orders sink to the bottom rather
 * than jumping the queue on the strength of a large negative CR.
 */
export function sequenceByPriority(input: PriorityInput): string[] {
  const scored = scoreAllPriorities(input);
  const orderIndex = new Map(input.orders.map((o, i) => [o.id, i]));

  return [...scored]
    .sort((a, b) => {
      const aLost = a.bucket === "replan_delivery" ? 1 : 0;
      const bLost = b.bucket === "replan_delivery" ? 1 : 0;
      if (aLost !== bLost) return aLost - bLost;
      if (b.score !== a.score) return b.score - a.score;
      return (orderIndex.get(a.orderId) ?? 0) - (orderIndex.get(b.orderId) ?? 0);
    })
    .map((s) => s.orderId);
}

/**
 * Slack per remaining operation. Behaves better than raw CR in a flow shop
 * because it normalises by how many stages are still ahead of the order.
 */
export function sequenceBySlackPerOperation(input: PriorityInput): string[] {
  const today = input.today ?? new Date().toISOString().split("T")[0]!;
  const styleMap = new Map(input.styles.map((s) => [s.id, s]));

  return [...input.orders]
    .map((order) => {
      const style = styleMap.get(order.styleId);
      const lead = style
        ? estimateRemainingLeadTime(order, style, input.lines)
        : 0;
      // Per this order's own route, not the factory's — a style that skips
      // knitting has one fewer operation to divide its slack across.
      const route = style ? stagesForRoute(style.routeId) : STAGE_ORDER;
      const stagesWithLines = route.filter((stage) =>
        input.lines.some((l) => l.stage === stage)
      ).length;
      const operations = Math.max(1, stagesWithLines);
      const daysUntilDue = differenceInCalendarDays(
        parseISO(order.deliveryDeadline),
        parseISO(today)
      );
      return { order, ratio: (daysUntilDue - lead) / operations };
    })
    .sort((a, b) => {
      if (a.ratio !== b.ratio) return a.ratio - b.ratio;
      return a.order.priority - b.order.priority;
    })
    .map((entry) => entry.order.id);
}
