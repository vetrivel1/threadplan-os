import { addDays, format, parseISO } from "date-fns";
import type { Order } from "../types";
import { runScenario, type ScenarioBase, type ScenarioDiff } from "./scenario";

/**
 * Cut-off warning: the latest a change can land before the plan can no longer
 * absorb it.
 *
 * The engine already answers "what happens if this order's material slips N
 * days" via the what-if scenario path — this just tests that question at
 * increasing N and binary-searches for the boundary, rather than making a
 * planner guess at N themselves. Feasibility is assumed monotonic (more delay
 * never makes things easier), which the objective's structure guarantees in
 * practice even though nothing enforces it as an invariant.
 */

export interface CutoffProbe {
  days: number;
  absorbable: boolean;
  diff: ScenarioDiff;
}

export interface CutoffResult {
  orderId: string;
  /** Largest tested delay, in days, that stayed absorbable. -1 if even a
   * zero-day change already breaks something (the order has no slack today). */
  maxAbsorbableDays: number;
  /** Smallest tested delay that broke feasibility, or null if the search
   * bound was never reached. */
  firstUnabsorbableDays: number | null;
  /** The order's material in-house date, moved out by `maxAbsorbableDays`. */
  cutoffDate: string | null;
  /** Every probe run during the search, for showing the search itself. */
  probes: CutoffProbe[];
}

const DEFAULT_MAX_DAYS = 30;

/**
 * Default definition of "absorbed": the order under test still completes by
 * its own deadline. Checking the aggregate late-order count instead would
 * under-warn on a plan that already has late orders elsewhere, since one more
 * day on an already-late order somewhere else doesn't change that count. A
 * planner who wants a stricter bar (e.g. no score regression at all) can
 * supply their own `isAbsorbable`.
 */
function defaultIsAbsorbable(diff: ScenarioDiff, order: Order): boolean {
  const shift = diff.completionShifts.find((s) => s.orderId === order.id);
  if (!shift?.scenario) return true;
  return shift.scenario <= order.deliveryDeadline;
}

export function findRmCutoff(params: {
  base: ScenarioBase;
  orderId: string;
  maxDays?: number;
  isAbsorbable?: (diff: ScenarioDiff, order: Order) => boolean;
}): CutoffResult {
  const { base, orderId, maxDays = DEFAULT_MAX_DAYS } = params;
  const isAbsorbable = params.isAbsorbable ?? defaultIsAbsorbable;

  const order = base.orders.find((o) => o.id === orderId);
  if (!order) {
    return { orderId, maxAbsorbableDays: -1, firstUnabsorbableDays: 0, cutoffDate: null, probes: [] };
  }

  const probes: CutoffProbe[] = [];
  const probe = (days: number): CutoffProbe => {
    const result = runScenario(base, {
      name: `cutoff-probe-${orderId}-${days}`,
      mutations: [{ type: "shiftRmDate", orderId, days }],
    });
    const p = { days, absorbable: isAbsorbable(result.diff, order), diff: result.diff };
    probes.push(p);
    return p;
  };

  const cutoffDateFor = (days: number): string | null =>
    format(addDays(parseISO(order.rmInHouseDate), days), "yyyy-MM-dd");

  const atZero = probe(0);
  if (!atZero.absorbable) {
    return {
      orderId,
      maxAbsorbableDays: -1,
      firstUnabsorbableDays: 0,
      cutoffDate: null,
      probes,
    };
  }

  const atMax = probe(maxDays);
  if (atMax.absorbable) {
    return {
      orderId,
      maxAbsorbableDays: maxDays,
      firstUnabsorbableDays: null,
      cutoffDate: cutoffDateFor(maxDays),
      probes,
    };
  }

  let lo = 0;
  let hi = maxDays;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    const result = probe(mid);
    if (result.absorbable) lo = mid;
    else hi = mid;
  }

  return {
    orderId,
    maxAbsorbableDays: lo,
    firstUnabsorbableDays: hi,
    cutoffDate: cutoffDateFor(lo),
    probes,
  };
}
