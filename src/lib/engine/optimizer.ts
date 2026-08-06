import type {
  LearningCurvePoint,
  Order,
  ProductionLine,
  ScheduleCell,
  Style,
} from "../types";
import {
  ASSIGNMENT_STRATEGIES,
  buildAssignments,
  type AssignmentStrategy,
} from "./assignment";
import {
  scorePlan,
  type ObjectiveBreakdown,
  type ScoringWeights,
} from "./objective";
import type { PhysicsOptions } from "./physics";
import {
  sequenceByPriority,
  sequenceBySlackPerOperation,
} from "./priority-score";
import {
  buildSchedule,
  type LineAssignment,
  type SchedulerOutput,
} from "./scheduler";
import {
  SEQUENCE_HORIZON_DAYS,
  sortOrdersBySequence,
} from "./sequencing-policy";

/**
 * The optimizer.
 *
 * `buildSchedule` is deterministic and fast, which makes it a usable evaluator
 * rather than just a plan generator. So instead of trusting a single dispatch
 * rule, this proposes a spread of candidate plans, simulates each one, scores
 * them against the shared objective, and hill-climbs from the winner.
 *
 * The deadline + spreadAll candidate is always evaluated and always returned as
 * `baseline`, both as a safe fallback and so a planner can see what the
 * optimization actually bought.
 */

export type SequenceStrategy =
  | "deadline"
  | "criticalRatio"
  | "slackPerOperation"
  | "changeoverMinimizing";

export const SEQUENCE_STRATEGIES: SequenceStrategy[] = [
  "deadline",
  "criticalRatio",
  "slackPerOperation",
  "changeoverMinimizing",
];

export interface OptimizerInput {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  existingLocks?: ScheduleCell[];
  startDate?: string;
  horizonDays?: number;
  physics?: Partial<PhysicsOptions>;
  weights?: Partial<ScoringWeights>;
  /** Sequence currently published to the floor, used to penalise churn. */
  referenceSequence?: string[];
  /** Hill-climbing passes. Each pass tries every adjacent swap. */
  maxLocalSearchPasses?: number;
  /** Set false to return only the strategy grid, without hill climbing. */
  localSearch?: boolean;
}

export interface PlanCandidate {
  id: string;
  sequenceStrategy: SequenceStrategy | "localSearch";
  assignmentStrategy: AssignmentStrategy;
  sequence: string[];
  assignments: LineAssignment[];
  output: SchedulerOutput;
  breakdown: ObjectiveBreakdown;
}

export interface OptimizerResult {
  best: PlanCandidate;
  runnersUp: PlanCandidate[];
  baseline: PlanCandidate;
  evaluated: number;
  elapsedMs: number;
  /** Objective points the winner improves on the baseline. Negative means worse. */
  improvement: number;
}

const DEFAULT_LOCAL_SEARCH_PASSES = 12;

export function optimizeSchedule(input: OptimizerInput): OptimizerResult {
  const started = Date.now();
  const startDate =
    input.startDate ?? new Date().toISOString().split("T")[0]!;
  const horizonDays = input.horizonDays ?? SEQUENCE_HORIZON_DAYS;

  let evaluated = 0;

  const evaluate = (
    sequence: string[],
    assignmentStrategy: AssignmentStrategy,
    sequenceStrategy: SequenceStrategy | "localSearch"
  ): PlanCandidate => {
    const assignments = buildAssignments(assignmentStrategy, {
      orders: input.orders,
      styles: input.styles,
      lines: input.lines,
      sequence,
    });

    const output = buildSchedule({
      orders: input.orders,
      styles: input.styles,
      lines: input.lines,
      learningCurves: input.learningCurves,
      existingLocks: input.existingLocks ?? [],
      lineAssignments: assignments,
      sequence,
      startDate,
      horizonDays,
      physics: input.physics,
    });

    const breakdown = scorePlan({
      orders: input.orders,
      lines: input.lines,
      output,
      startDate,
      sequence,
      referenceSequence: input.referenceSequence,
      weights: input.weights,
    });

    evaluated++;

    return {
      id: `${sequenceStrategy}:${assignmentStrategy}:${evaluated}`,
      sequenceStrategy,
      assignmentStrategy,
      sequence,
      assignments,
      output,
      breakdown,
    };
  };

  const sequences = buildSequenceCandidates(input, startDate);
  const candidates: PlanCandidate[] = [];

  for (const strategy of SEQUENCE_STRATEGIES) {
    const sequence = sequences[strategy];
    for (const assignmentStrategy of ASSIGNMENT_STRATEGIES) {
      candidates.push(evaluate(sequence, assignmentStrategy, strategy));
    }
  }

  const baseline =
    candidates.find(
      (c) =>
        c.sequenceStrategy === "deadline" &&
        c.assignmentStrategy === "spreadAll"
    ) ?? candidates[0]!;

  candidates.sort((a, b) => a.breakdown.score - b.breakdown.score);
  let best = candidates[0]!;

  if (input.localSearch !== false) {
    best = hillClimb(best, evaluate, {
      maxPasses: input.maxLocalSearchPasses ?? DEFAULT_LOCAL_SEARCH_PASSES,
    });
  }

  const runnersUp = candidates
    .filter((c) => c !== best)
    .slice(0, 4);

  return {
    best,
    runnersUp,
    baseline,
    evaluated,
    elapsedMs: Date.now() - started,
    improvement: round(baseline.breakdown.score - best.breakdown.score),
  };
}

/**
 * Adjacent-swap hill climbing. Small neighbourhood on purpose: the sequence is
 * order-count sized, every evaluation is a full simulation, and planners value
 * a plan that stays close to something explainable.
 */
function hillClimb(
  start: PlanCandidate,
  evaluate: (
    sequence: string[],
    assignmentStrategy: AssignmentStrategy,
    sequenceStrategy: SequenceStrategy | "localSearch"
  ) => PlanCandidate,
  options: { maxPasses: number }
): PlanCandidate {
  let current = start;

  for (let pass = 0; pass < options.maxPasses; pass++) {
    let improved = false;

    for (let i = 0; i < current.sequence.length - 1; i++) {
      const trial = [...current.sequence];
      const a = trial[i]!;
      const b = trial[i + 1]!;
      trial[i] = b;
      trial[i + 1] = a;

      const candidate = evaluate(
        trial,
        current.assignmentStrategy,
        "localSearch"
      );
      if (candidate.breakdown.score < current.breakdown.score) {
        current = candidate;
        improved = true;
      }
    }

    if (!improved) break;
  }

  return current;
}

function buildSequenceCandidates(
  input: OptimizerInput,
  today: string
): Record<SequenceStrategy, string[]> {
  const priorityInput = {
    orders: input.orders,
    styles: input.styles,
    lines: input.lines,
    today,
  };

  return {
    deadline: sortOrdersBySequence(input.orders).map((o) => o.id),
    criticalRatio: sequenceByPriority(priorityInput),
    slackPerOperation: sequenceBySlackPerOperation(priorityInput),
    changeoverMinimizing: sequenceByChangeover(input.orders),
  };
}

/**
 * Cluster orders of the same style together so a line can keep running without
 * a setup, while ordering the clusters by their most urgent member so grouping
 * does not quietly sacrifice a deadline.
 */
export function sequenceByChangeover(orders: Order[]): string[] {
  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const group = groups.get(order.styleId);
    if (group) group.push(order);
    else groups.set(order.styleId, [order]);
  }

  return [...groups.values()]
    .map((group) => sortOrdersBySequence(group))
    .sort((a, b) => {
      const aFirst = a[0]!;
      const bFirst = b[0]!;
      if (aFirst.deliveryDeadline !== bFirst.deliveryDeadline) {
        return aFirst.deliveryDeadline < bFirst.deliveryDeadline ? -1 : 1;
      }
      return aFirst.priority - bFirst.priority;
    })
    .flat()
    .map((o) => o.id);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
