import type {
  LearningCurvePoint,
  Order,
  ProductionLine,
  ScheduleCell,
  Style,
} from "@/lib/types";
import type { ObjectiveBreakdown } from "./objective";
import { optimizeSchedule, type PlanCandidate } from "./optimizer";
import { buildSchedule } from "./scheduler";
import { SEQUENCE_HORIZON_DAYS } from "./sequencing-policy";

export interface AutoSequenceInput {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  existingLocks?: ScheduleCell[];
  horizonDays?: number;
  /** Sequence already published to the floor, so churn is penalised. */
  referenceSequence?: string[];
  /** Set false to fall back to the plain deadline-ordered schedule. */
  optimize?: boolean;
}

export interface AutoSequenceResult {
  cells: ScheduleCell[];
  orders: Order[];
  orderCompletions: Record<string, string>;
  sequence: string[];
  /** Absent when the optimizer was skipped or unavailable. */
  breakdown?: ObjectiveBreakdown;
  baselineBreakdown?: ObjectiveBreakdown;
  improvement?: number;
  evaluated?: number;
  elapsedMs?: number;
  strategy?: string;
}

export function runAutoSequence(input: AutoSequenceInput): AutoSequenceResult {
  const horizonDays = input.horizonDays ?? SEQUENCE_HORIZON_DAYS;

  if (input.optimize !== false) {
    try {
      const result = optimizeSchedule({
        orders: input.orders,
        styles: input.styles,
        lines: input.lines,
        learningCurves: input.learningCurves,
        existingLocks: input.existingLocks ?? [],
        horizonDays,
        referenceSequence: input.referenceSequence,
      });
      return toResult(input.orders, result.best, {
        baselineBreakdown: result.baseline.breakdown,
        improvement: result.improvement,
        evaluated: result.evaluated,
        elapsedMs: result.elapsedMs,
      });
    } catch {
      // A failed search must never block planning — fall through to the plain
      // deadline-ordered schedule below.
    }
  }

  const result = buildSchedule({
    orders: input.orders,
    styles: input.styles,
    lines: input.lines,
    learningCurves: input.learningCurves,
    existingLocks: input.existingLocks ?? [],
    horizonDays,
  });

  const orders = input.orders.map((o) => ({
    ...o,
    status: result.orderStatuses[o.id] ?? o.status,
  }));

  return {
    cells: result.cells,
    orders,
    orderCompletions: result.orderCompletions,
    sequence: orders.map((o) => o.id),
  };
}

function toResult(
  inputOrders: Order[],
  candidate: PlanCandidate,
  extras: {
    baselineBreakdown: ObjectiveBreakdown;
    improvement: number;
    evaluated: number;
    elapsedMs: number;
  }
): AutoSequenceResult {
  const orders = inputOrders.map((o) => ({
    ...o,
    status: candidate.output.orderStatuses[o.id] ?? o.status,
  }));

  return {
    cells: candidate.output.cells,
    orders,
    orderCompletions: candidate.output.orderCompletions,
    sequence: candidate.sequence,
    breakdown: candidate.breakdown,
    baselineBreakdown: extras.baselineBreakdown,
    improvement: extras.improvement,
    evaluated: extras.evaluated,
    elapsedMs: extras.elapsedMs,
    strategy: `${candidate.sequenceStrategy}+${candidate.assignmentStrategy}`,
  };
}
