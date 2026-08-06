import { differenceInCalendarDays, parseISO } from "date-fns";
import type { Order, ProductionLine } from "../types";
import { wipUnitDays } from "./pack-ratio";
import type { SchedulerOutput } from "./scheduler";

/**
 * The multi-criteria objective.
 *
 * Everything the optimizer does is in service of minimising this number. The
 * weights encode the factory's own trade-offs — how many hours of changeover a
 * day of lateness is worth — which is a business decision, not an engineering
 * one. They live in a single object precisely so they can be lifted into a
 * configurable rules engine without touching the search.
 *
 * Lower is better.
 */
export interface ScoringWeights {
  /** Per weighted day an order finishes past its deadline. */
  tardiness: number;
  /** Flat penalty for an order that does not finish inside the horizon at all. */
  unfinished: number;
  /** Per hour lost to style changeovers. */
  changeover: number;
  /** Per idle line-hour inside the makespan. */
  idle: number;
  /** Per order whose position moved against the published plan. */
  churn: number;
  /** Credit per unit shipped inside the horizon (subtracted from the score). */
  throughput: number;
  /**
   * Per unit-day of stock produced that cannot yet close a carton.
   *
   * Set to match the throughput credit so a unit stranded for a day cancels
   * the credit earned for making it — stitching stock that cannot ship is not
   * progress.
   */
  wip: number;
}

export const SCORING_WEIGHTS: ScoringWeights = {
  tardiness: 10,
  unfinished: 250,
  changeover: 1.5,
  idle: 0.05,
  churn: 4,
  throughput: 0.002,
  wip: 0.002,
};

export interface ObjectiveBreakdown {
  weightedTardinessDays: number;
  rawTardinessDays: number;
  lateOrders: number;
  unfinishedOrders: number;
  changeoverHours: number;
  idleCapacityHours: number;
  churn: number;
  unitsCompleted: number;
  /** Unit-days of sewing output stranded because a carton could not close. */
  wipUnitDays: number;
  makespanDays: number;
  score: number;
}

export interface ObjectiveInput {
  orders: Order[];
  lines: ProductionLine[];
  output: SchedulerOutput;
  startDate: string;
  /** Sequence that produced this plan, for churn measurement. */
  sequence?: string[];
  /** Sequence currently published to the floor. */
  referenceSequence?: string[];
  weights?: Partial<ScoringWeights>;
}

/**
 * A late order matters more when the planner flagged it as important. Priority
 * is "lower number is more urgent" in this codebase.
 */
export function tardinessWeight(priority: number): number {
  return Math.max(0.5, 2 - priority / 40);
}

export function scorePlan(input: ObjectiveInput): ObjectiveBreakdown {
  const { orders, lines, output, startDate } = input;
  const weights = { ...SCORING_WEIGHTS, ...input.weights };

  let weightedTardinessDays = 0;
  let rawTardinessDays = 0;
  let lateOrders = 0;
  let unfinishedOrders = 0;

  for (const order of orders) {
    const completion = output.orderCompletions[order.id];
    if (!completion) {
      unfinishedOrders++;
      continue;
    }
    const daysLate = differenceInCalendarDays(
      parseISO(completion),
      parseISO(order.deliveryDeadline)
    );
    if (daysLate > 0) {
      lateOrders++;
      rawTardinessDays += daysLate;
      weightedTardinessDays += daysLate * tardinessWeight(order.priority);
    }
  }

  const makespanDays = computeMakespanDays(output, startDate);
  const idleCapacityHours = computeIdleHours(output, lines, makespanDays);
  const changeoverHours = output.changeoverMinutes / 60;
  const unitsCompleted = output.cells
    .filter((c) => c.stage === "packing")
    .reduce((sum, c) => sum + c.capacityUsed, 0);
  const churn = computeChurn(input.sequence, input.referenceSequence);
  const wip = wipUnitDays({ orders, cells: output.cells });

  const score =
    weights.tardiness * weightedTardinessDays +
    weights.unfinished * unfinishedOrders +
    weights.changeover * changeoverHours +
    weights.idle * idleCapacityHours +
    weights.churn * churn +
    weights.wip * wip -
    weights.throughput * unitsCompleted;

  return {
    weightedTardinessDays: round(weightedTardinessDays),
    rawTardinessDays,
    lateOrders,
    unfinishedOrders,
    changeoverHours: round(changeoverHours),
    idleCapacityHours: round(idleCapacityHours),
    churn,
    unitsCompleted,
    wipUnitDays: wip,
    makespanDays,
    score: round(score),
  };
}

function computeMakespanDays(
  output: SchedulerOutput,
  startDate: string
): number {
  if (output.cells.length === 0) return 0;
  let last = output.cells[0]!.date;
  for (const cell of output.cells) {
    if (cell.date > last) last = cell.date;
  }
  return (
    differenceInCalendarDays(parseISO(last), parseISO(startDate)) + 1
  );
}

/**
 * Line-hours available inside the makespan that nothing was scheduled into.
 *
 * Day-granular by design: the scheduler books at most one order per line per
 * day, so a day with no cell for a line is an idle day.
 */
function computeIdleHours(
  output: SchedulerOutput,
  lines: ProductionLine[],
  makespanDays: number
): number {
  if (makespanDays <= 0) return 0;

  const usedDaysByLine = new Map<string, Set<string>>();
  for (const cell of output.cells) {
    let set = usedDaysByLine.get(cell.lineId);
    if (!set) {
      set = new Set();
      usedDaysByLine.set(cell.lineId, set);
    }
    set.add(cell.date);
  }

  let idleHours = 0;
  for (const line of lines) {
    const used = usedDaysByLine.get(line.id)?.size ?? 0;
    const idleDays = Math.max(0, makespanDays - used);
    idleHours += (idleDays * line.shiftMinutes) / 60;
  }
  return idleHours;
}

/**
 * How far the plan drags orders away from what the floor was already told.
 * Counting moved orders rather than total displacement keeps a single insertion
 * from looking like a wholesale reshuffle.
 */
function computeChurn(
  sequence?: string[],
  referenceSequence?: string[]
): number {
  if (!sequence || !referenceSequence) return 0;

  const referenceIndex = new Map(referenceSequence.map((id, i) => [id, i]));
  let moved = 0;
  sequence.forEach((id, i) => {
    const before = referenceIndex.get(id);
    if (before != null && before !== i) moved++;
  });
  return moved;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
