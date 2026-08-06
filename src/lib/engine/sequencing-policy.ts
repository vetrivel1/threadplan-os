import { differenceInCalendarDays, parseISO } from "date-fns";
import type { Order } from "../types";

/**
 * Single source of truth for how orders are sequenced and how delivery risk is
 * classified. Both the scheduler and the Auto-Sequence view read from here so
 * the ranking a planner sees always matches the ranking that was scheduled.
 */

/** Completion within this many days of the deadline counts as at risk. */
export const AT_RISK_WINDOW_DAYS = 3;

/** Horizon used when sequencing incoming ERP orders. */
export const SEQUENCE_HORIZON_DAYS = 45;

/** Horizon used when replanning around locked actuals — cascades run longer. */
export const REPLAN_HORIZON_DAYS = 90;

/** Fallback horizon when a caller does not specify one. */
export const DEFAULT_SCHEDULE_HORIZON_DAYS = 60;

export type DeliveryRisk = "delayed" | "at_risk" | "on_track";

export interface SequenceableOrder {
  deliveryDeadline: string;
  priority: number;
}

/**
 * Ranking policy: earliest customer deadline first, planner priority breaks ties.
 */
export function compareOrdersBySequence(
  a: SequenceableOrder,
  b: SequenceableOrder
): number {
  const deadlineDiff =
    parseISO(a.deliveryDeadline).getTime() -
    parseISO(b.deliveryDeadline).getTime();
  if (deadlineDiff !== 0) return deadlineDiff;
  return a.priority - b.priority;
}

export function sortOrdersBySequence<T extends SequenceableOrder>(
  orders: T[]
): T[] {
  return [...orders].sort(compareOrdersBySequence);
}

/**
 * Classify a projected completion against its deadline.
 */
export function classifyDeliveryRisk(
  completionDate: string,
  deliveryDeadline: string
): DeliveryRisk {
  const daysEarly = differenceInCalendarDays(
    parseISO(deliveryDeadline),
    parseISO(completionDate)
  );
  if (daysEarly < 0) return "delayed";
  if (daysEarly < AT_RISK_WINDOW_DAYS) return "at_risk";
  return "on_track";
}

/**
 * Same classification mapped onto order status, for callers that treat an
 * on-track order as actively in progress.
 */
export function deriveOrderStatus(
  completionDate: string,
  deliveryDeadline: string
): Order["status"] {
  const risk = classifyDeliveryRisk(completionDate, deliveryDeadline);
  return risk === "on_track" ? "in_progress" : risk;
}
