import { differenceInCalendarDays, parseISO } from "date-fns";
import type {
  LearningCurvePoint,
  Order,
  ProductionLine,
  StageCode,
  Style,
} from "../types";
import { dailyLineCapacity, getLearningEfficiency } from "./capacity";

/**
 * Run-size viability.
 *
 * A line climbing a learning curve only pays that cost back over a long enough
 * run. If an order finishes while the line is still ramping, the factory never
 * sees target efficiency on it — the setup and the ramp are pure loss. Flagging
 * that lets a planner combine POs or divert the order to a small-batch line
 * before the plan is published rather than discovering it in the variance
 * report afterwards.
 */

/** Efficiency at which a line is considered "up to speed". */
export const VIABILITY_EFFICIENCY_THRESHOLD = 0.85;

/** A run is sub-scale if this much of it is spent below the threshold. */
export const SUB_SCALE_RAMP_SHARE = 0.5;

/** Orders of the same style within this many days are merge candidates. */
export const MERGE_WINDOW_DAYS = 21;

/** Stage the assessment is made against — sewing is where the ramp bites. */
const ASSESSED_STAGE: StageCode = "sewing";

export interface RunSizeAssessment {
  orderId: string;
  orderNumber: string;
  quantity: number;
  /** Units produced before the line crosses the efficiency threshold. */
  unitsToReachThreshold: number;
  daysToReachThreshold: number;
  /** Fraction of this order produced while still below the threshold. */
  rampShare: number;
  subScale: boolean;
  /** Order ids of the same style close enough in time to combine with. */
  mergeCandidates: string[];
  /** Combined quantity if merged, when merge candidates exist. */
  mergedQuantity?: number;
  recommendation?: string;
}

export interface RunSizeInput {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  stage?: StageCode;
}

export function assessRunSizes(input: RunSizeInput): RunSizeAssessment[] {
  const stage = input.stage ?? ASSESSED_STAGE;
  const styleMap = new Map(input.styles.map((s) => [s.id, s]));
  const referenceLine = pickReferenceLine(input.lines, stage);
  if (!referenceLine) return [];

  const assessments: RunSizeAssessment[] = [];

  for (const order of input.orders) {
    const style = styleMap.get(order.styleId);
    if (!style) continue;

    const { units, days } = unitsBeforeThreshold({
      order,
      style,
      stage,
      line: referenceLine,
      learningCurves: input.learningCurves,
    });

    const rampShare =
      order.quantity > 0 ? Math.min(1, units / order.quantity) : 0;
    const subScale = rampShare >= SUB_SCALE_RAMP_SHARE;

    const mergeCandidates = findMergeCandidates(order, input.orders);
    const mergedQuantity =
      mergeCandidates.length > 0
        ? order.quantity +
          mergeCandidates.reduce((sum, id) => {
            const other = input.orders.find((o) => o.id === id);
            return sum + (other?.quantity ?? 0);
          }, 0)
        : undefined;

    assessments.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      quantity: order.quantity,
      unitsToReachThreshold: units,
      daysToReachThreshold: days,
      rampShare: Math.round(rampShare * 1000) / 1000,
      subScale,
      mergeCandidates,
      mergedQuantity,
      recommendation: buildRecommendation({
        subScale,
        rampShare,
        mergeCandidates,
        mergedQuantity,
        units,
      }),
    });
  }

  return assessments;
}

/**
 * Walks the learning curve day by day, accumulating what the line would produce
 * before it reaches the efficiency threshold.
 */
function unitsBeforeThreshold(params: {
  order: Order;
  style: Style;
  stage: StageCode;
  line: ProductionLine;
  learningCurves: Record<string, LearningCurvePoint[]>;
}): { units: number; days: number } {
  const { order, style, stage, line, learningCurves } = params;
  const maxDays = 30;

  let units = 0;
  for (let day = 1; day <= maxDays; day++) {
    const efficiency = getLearningEfficiency(
      learningCurves,
      style.id,
      day,
      style.complexity
    );
    if (efficiency >= VIABILITY_EFFICIENCY_THRESHOLD) {
      return { units, days: day - 1 };
    }
    units += dailyLineCapacity(
      line.operators,
      line.shiftMinutes,
      style.smv[stage],
      efficiency * line.efficiencyBaseline,
      order.packingType,
      stage
    );
  }

  return { units, days: maxDays };
}

/**
 * Highest-throughput line in the stage, as the optimistic case. If even the
 * best line cannot get the order up to speed, none can.
 */
function pickReferenceLine(
  lines: ProductionLine[],
  stage: StageCode
): ProductionLine | undefined {
  const stageLines = lines.filter((l) => l.stage === stage);
  if (stageLines.length === 0) return undefined;
  return stageLines.reduce((best, line) =>
    line.operators * line.efficiencyBaseline >
    best.operators * best.efficiencyBaseline
      ? line
      : best
  );
}

function findMergeCandidates(order: Order, orders: Order[]): string[] {
  return orders
    .filter(
      (other) =>
        other.id !== order.id &&
        other.styleId === order.styleId &&
        Math.abs(
          differenceInCalendarDays(
            parseISO(other.deliveryDeadline),
            parseISO(order.deliveryDeadline)
          )
        ) <= MERGE_WINDOW_DAYS
    )
    .map((other) => other.id);
}

function buildRecommendation(params: {
  subScale: boolean;
  rampShare: number;
  mergeCandidates: string[];
  mergedQuantity?: number;
  units: number;
}): string | undefined {
  const { subScale, rampShare, mergeCandidates, mergedQuantity, units } = params;
  if (!subScale) return undefined;

  const pct = Math.round(rampShare * 100);

  if (mergeCandidates.length > 0 && mergedQuantity != null) {
    return `${pct}% of this run finishes before the line reaches target efficiency. Combining with ${mergeCandidates.length} same-style order(s) would take the run to ${mergedQuantity} units and amortise the ramp.`;
  }

  return `${pct}% of this run finishes before the line reaches target efficiency (needs about ${units} units to get up to speed). Consider a small-batch line.`;
}
