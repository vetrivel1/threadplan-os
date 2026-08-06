import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type {
  LearningCurvePoint,
  Order,
  PackingType,
  ProductionLine,
  ScheduleCell,
  StageCode,
  Style,
} from "../types";
import { buildAssignments, type AssignmentStrategy } from "./assignment";
import {
  scorePlan,
  type ObjectiveBreakdown,
  type ScoringWeights,
} from "./objective";
import { optimizeSchedule } from "./optimizer";
import type { PhysicsOptions } from "./physics";
import { buildSchedule, type SchedulerOutput } from "./scheduler";
import { SEQUENCE_HORIZON_DAYS, sortOrdersBySequence } from "./sequencing-policy";

/**
 * What-if simulation.
 *
 * A scenario is just another candidate plan built from perturbed inputs, so the
 * same evaluator and the same objective apply. Two questions are worth asking
 * and they need different settings:
 *
 *  - "What happens to the plan I already published?" — hold the sequence fixed
 *    (the default). This is the honest answer to a fabric delay.
 *  - "What is the best I could do about it?" — set `reoptimize`, which lets the
 *    optimizer resequence around the disruption.
 */

export type ScenarioMutation =
  | { type: "shiftRmDate"; orderId: string; days: number }
  | { type: "shiftDeadline"; orderId: string; days: number }
  | { type: "addOvertime"; lineId?: string; stage?: StageCode; extraMinutes: number }
  | { type: "changeOperators"; lineId: string; delta: number }
  | { type: "addOrder"; order: Order }
  | { type: "dropOrder"; orderId: string }
  | { type: "changeQuantity"; orderId: string; quantity: number }
  | { type: "changePackingType"; orderId: string; packingType: PackingType };

export interface ScenarioBase {
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  existingLocks?: ScheduleCell[];
  startDate?: string;
  horizonDays?: number;
  physics?: Partial<PhysicsOptions>;
  weights?: Partial<ScoringWeights>;
  /** Sequence the current plan uses. Defaults to the deadline policy order. */
  sequence?: string[];
  assignmentStrategy?: AssignmentStrategy;
}

export interface CompletionShift {
  orderId: string;
  baseline?: string;
  scenario?: string;
  deltaDays: number | null;
}

export interface ScenarioDiff {
  scoreDelta: number;
  lateOrdersDelta: number;
  changeoverHoursDelta: number;
  makespanDaysDelta: number;
  completionShifts: CompletionShift[];
}

export interface ScenarioResult {
  name: string;
  mutations: ScenarioMutation[];
  reoptimized: boolean;
  output: SchedulerOutput;
  breakdown: ObjectiveBreakdown;
  sequence: string[];
  diff: ScenarioDiff;
}

export interface RunScenarioOptions {
  name: string;
  mutations: ScenarioMutation[];
  /** Let the optimizer resequence around the change instead of holding the plan. */
  reoptimize?: boolean;
  /** Force a specific sequence, for modelling an explicit resequencing action. */
  sequenceOverride?: string[];
  /** Force a specific line assignment strategy for this scenario. */
  assignmentOverride?: AssignmentStrategy;
}

export function runScenario(
  base: ScenarioBase,
  options: RunScenarioOptions
): ScenarioResult {
  const baselinePlan = evaluateBase(base);
  const mutated = applyMutations(base, options.mutations);

  const startDate =
    mutated.startDate ?? new Date().toISOString().split("T")[0]!;
  const horizonDays = mutated.horizonDays ?? SEQUENCE_HORIZON_DAYS;

  let output: SchedulerOutput;
  let sequence: string[];

  if (options.reoptimize) {
    const optimized = optimizeSchedule({
      orders: mutated.orders,
      styles: mutated.styles,
      lines: mutated.lines,
      learningCurves: mutated.learningCurves,
      existingLocks: mutated.existingLocks ?? [],
      startDate,
      horizonDays,
      physics: mutated.physics,
      weights: mutated.weights,
      referenceSequence: baselinePlan.sequence,
    });
    output = optimized.best.output;
    sequence = optimized.best.sequence;
  } else {
    // Keep the published order unless the scenario is explicitly about changing
    // it. Orders added by the scenario land at the end of the sequence, which
    // orderBySequenceIds handles by policy order.
    const source = options.sequenceOverride ?? baselinePlan.sequence;
    sequence = source.filter((id) =>
      mutated.orders.some((o) => o.id === id)
    );
    const assignments = buildAssignments(
      options.assignmentOverride ?? mutated.assignmentStrategy ?? "spreadAll",
      {
        orders: mutated.orders,
        styles: mutated.styles,
        lines: mutated.lines,
        sequence,
      }
    );
    output = buildSchedule({
      orders: mutated.orders,
      styles: mutated.styles,
      lines: mutated.lines,
      learningCurves: mutated.learningCurves,
      existingLocks: mutated.existingLocks ?? [],
      lineAssignments: assignments,
      sequence,
      startDate,
      horizonDays,
      physics: mutated.physics,
    });
  }

  const breakdown = scorePlan({
    orders: mutated.orders,
    lines: mutated.lines,
    output,
    startDate,
    sequence,
    referenceSequence: baselinePlan.sequence,
    weights: mutated.weights,
  });

  return {
    name: options.name,
    mutations: options.mutations,
    reoptimized: Boolean(options.reoptimize),
    output,
    breakdown,
    sequence,
    diff: diffPlans(baselinePlan, { output, breakdown }),
  };
}

interface EvaluatedPlan {
  output: SchedulerOutput;
  breakdown: ObjectiveBreakdown;
  sequence: string[];
}

export function evaluateBase(base: ScenarioBase): EvaluatedPlan {
  const startDate = base.startDate ?? new Date().toISOString().split("T")[0]!;
  const horizonDays = base.horizonDays ?? SEQUENCE_HORIZON_DAYS;
  const sequence =
    base.sequence ?? sortOrdersBySequence(base.orders).map((o) => o.id);

  const assignments = buildAssignments(base.assignmentStrategy ?? "spreadAll", {
    orders: base.orders,
    styles: base.styles,
    lines: base.lines,
    sequence,
  });

  const output = buildSchedule({
    orders: base.orders,
    styles: base.styles,
    lines: base.lines,
    learningCurves: base.learningCurves,
    existingLocks: base.existingLocks ?? [],
    lineAssignments: assignments,
    sequence,
    startDate,
    horizonDays,
    physics: base.physics,
  });

  const breakdown = scorePlan({
    orders: base.orders,
    lines: base.lines,
    output,
    startDate,
    sequence,
    weights: base.weights,
  });

  return { output, breakdown, sequence };
}

export function applyMutations(
  base: ScenarioBase,
  mutations: ScenarioMutation[]
): ScenarioBase {
  let orders = base.orders.map((o) => ({ ...o }));
  let lines = base.lines.map((l) => ({ ...l }));

  for (const mutation of mutations) {
    switch (mutation.type) {
      case "shiftRmDate": {
        orders = orders.map((o) =>
          o.id === mutation.orderId ? shiftOrderMaterials(o, mutation.days) : o
        );
        break;
      }
      case "shiftDeadline": {
        orders = orders.map((o) =>
          o.id === mutation.orderId
            ? { ...o, deliveryDeadline: shiftDate(o.deliveryDeadline, mutation.days) }
            : o
        );
        break;
      }
      case "changeQuantity": {
        orders = orders.map((o) =>
          o.id === mutation.orderId
            ? { ...o, quantity: Math.max(0, mutation.quantity) }
            : o
        );
        break;
      }
      case "addOrder": {
        orders = [...orders, { ...mutation.order }];
        break;
      }
      case "dropOrder": {
        orders = orders.filter((o) => o.id !== mutation.orderId);
        break;
      }
      case "addOvertime": {
        lines = lines.map((l) => {
          const matchesLine = !mutation.lineId || l.id === mutation.lineId;
          const matchesStage = !mutation.stage || l.stage === mutation.stage;
          return matchesLine && matchesStage
            ? { ...l, shiftMinutes: l.shiftMinutes + mutation.extraMinutes }
            : l;
        });
        break;
      }
      case "changePackingType": {
        orders = orders.map((o) =>
          o.id === mutation.orderId
            ? { ...o, packingType: mutation.packingType }
            : o
        );
        break;
      }
      case "changeOperators": {
        lines = lines.map((l) =>
          l.id === mutation.lineId
            ? { ...l, operators: Math.max(1, l.operators + mutation.delta) }
            : l
        );
        break;
      }
    }
  }

  return { ...base, orders, lines };
}

function shiftOrderMaterials(order: Order, days: number): Order {
  return {
    ...order,
    rmInHouseDate: shiftDate(order.rmInHouseDate, days),
    materials: order.materials?.map((m) => ({
      ...m,
      inHouseDate: shiftDate(m.inHouseDate, days),
    })),
  };
}

function shiftDate(date: string, days: number): string {
  return format(addDays(parseISO(date), days), "yyyy-MM-dd");
}

function diffPlans(
  baseline: EvaluatedPlan,
  scenario: { output: SchedulerOutput; breakdown: ObjectiveBreakdown }
): ScenarioDiff {
  const orderIds = new Set([
    ...Object.keys(baseline.output.orderCompletions),
    ...Object.keys(scenario.output.orderCompletions),
  ]);

  const completionShifts: CompletionShift[] = [];
  for (const orderId of orderIds) {
    const before = baseline.output.orderCompletions[orderId];
    const after = scenario.output.orderCompletions[orderId];
    completionShifts.push({
      orderId,
      baseline: before,
      scenario: after,
      deltaDays:
        before && after
          ? differenceInCalendarDays(parseISO(after), parseISO(before))
          : null,
    });
  }

  completionShifts.sort(
    (a, b) => Math.abs(b.deltaDays ?? 0) - Math.abs(a.deltaDays ?? 0)
  );

  return {
    scoreDelta: round(scenario.breakdown.score - baseline.breakdown.score),
    lateOrdersDelta:
      scenario.breakdown.lateOrders - baseline.breakdown.lateOrders,
    changeoverHoursDelta: round(
      scenario.breakdown.changeoverHours - baseline.breakdown.changeoverHours
    ),
    makespanDaysDelta:
      scenario.breakdown.makespanDays - baseline.breakdown.makespanDays,
    completionShifts,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
