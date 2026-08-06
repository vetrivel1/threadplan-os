import { differenceInCalendarDays, parseISO } from "date-fns";
import type {
  LearningCurvePoint,
  Order,
  ProductionLine,
  RecoveryOption,
  ScheduleCell,
  Style,
} from "../types";
import type { PhysicsOptions } from "./physics";
import {
  evaluateBase,
  runScenario,
  type ScenarioBase,
  type ScenarioResult,
} from "./scenario";

/**
 * Recovery options grounded in simulation.
 *
 * Previously each option carried an `impactDays` that was either a fraction of
 * the delay or whatever the language model guessed. Here every option is run
 * through the scheduler as a scenario, so `impactDays` is the actual number of
 * days the target order pulls in. Options that turn out not to help are dropped
 * rather than presented with an invented benefit.
 */

/** Overtime modelled as two extra hours on every sewing line. */
const OVERTIME_MINUTES = 120;

export interface RecoveryInput {
  orderId: string;
  orders: Order[];
  styles: Style[];
  lines: ProductionLine[];
  learningCurves: Record<string, LearningCurvePoint[]>;
  existingLocks?: ScheduleCell[];
  startDate?: string;
  horizonDays?: number;
  physics?: Partial<PhysicsOptions>;
  sequence?: string[];
}

export interface SimulatedRecovery {
  options: RecoveryOption[];
  baselineCompletion?: string;
  /** True when at least one option was simulated to actually pull the date in. */
  anyEffective: boolean;
}

export function simulateRecoveryOptions(
  input: RecoveryInput
): SimulatedRecovery {
  const base: ScenarioBase = {
    orders: input.orders,
    styles: input.styles,
    lines: input.lines,
    learningCurves: input.learningCurves,
    existingLocks: input.existingLocks ?? [],
    startDate: input.startDate,
    horizonDays: input.horizonDays,
    physics: input.physics,
    sequence: input.sequence,
  };

  const baseline = evaluateBase(base);
  const baselineCompletion = baseline.output.orderCompletions[input.orderId];
  const target = input.orders.find((o) => o.id === input.orderId);
  if (!target) return { options: [], anyEffective: false };

  const expedited = [
    input.orderId,
    ...baseline.sequence.filter((id) => id !== input.orderId),
  ];

  const trials: Array<{
    option: Omit<RecoveryOption, "impactDays" | "confidence" | "isRecommended">;
    result: ScenarioResult;
  }> = [];

  trials.push({
    option: {
      id: "ot-sewing",
      type: "overtime",
      title: "Add 2h overtime on sewing lines",
      description:
        "Extend every sewing shift by two hours for the length of the plan.",
      costIndex: 65,
      details: { stage: "sewing", extraMinutes: OVERTIME_MINUTES },
    },
    result: runScenario(base, {
      name: "overtime",
      mutations: [
        { type: "addOvertime", stage: "sewing", extraMinutes: OVERTIME_MINUTES },
      ],
    }),
  });

  trials.push({
    option: {
      id: "swap-seq",
      type: "sequence_swap",
      title: "Move this order to the front of the queue",
      description:
        "Resequence so this order runs first, at the cost of pushing others back.",
      costIndex: 35,
      details: { swapType: "expedite_to_front" },
    },
    result: runScenario(base, {
      name: "expedite",
      mutations: [],
      sequenceOverride: expedited,
    }),
  });

  trials.push({
    option: {
      id: "split-line",
      type: "line_split",
      title: "Dedicate lines per order instead of sharing",
      description:
        "Pin each order to its own line so orders run in parallel rather than queueing behind one another.",
      costIndex: 80,
      details: { assignmentStrategy: "dedicate" },
    },
    result: runScenario(base, {
      name: "dedicate",
      mutations: [],
      assignmentOverride: "dedicate",
    }),
  });

  if (target.packingType === "assorted") {
    trials.push({
      option: {
        id: "expedite-pack",
        type: "expedite_stage",
        title: "Switch to solid-carton packing",
        description:
          "Drop assorted-box handling for this order to remove the packing cycle drag.",
        costIndex: 45,
        details: { stage: "packing", packingOverride: "solid" },
      },
      result: runScenario(base, {
        name: "solid-packing",
        mutations: [
          {
            type: "changePackingType",
            orderId: input.orderId,
            packingType: "solid",
          },
        ],
      }),
    });
  }

  const options: RecoveryOption[] = [];

  for (const trial of trials) {
    const after = trial.result.output.orderCompletions[input.orderId];
    const impactDays = daysPulledIn(baselineCompletion, after);
    if (impactDays <= 0) continue;

    options.push({
      ...trial.option,
      impactDays,
      confidence: confidenceFor(trial.result, impactDays),
      isRecommended: false,
      details: {
        ...trial.option.details,
        simulatedCompletion: after,
        baselineCompletion,
        scoreDelta: trial.result.diff.scoreDelta,
        lateOrdersDelta: trial.result.diff.lateOrdersDelta,
      },
    });
  }

  // Best option is the one that improves the whole-factory objective most per
  // unit of cost, not simply the one that pulls this order in the furthest.
  if (options.length > 0) {
    const best = [...options].sort((a, b) => {
      const aScore = scoreDeltaOf(a) / Math.max(1, a.costIndex);
      const bScore = scoreDeltaOf(b) / Math.max(1, b.costIndex);
      return aScore - bScore;
    })[0];
    for (const option of options) {
      option.isRecommended = option.id === best?.id;
    }
  }

  options.sort((a, b) => b.impactDays - a.impactDays);

  return {
    options,
    baselineCompletion,
    anyEffective: options.length > 0,
  };
}

function scoreDeltaOf(option: RecoveryOption): number {
  const delta = option.details?.scoreDelta;
  return typeof delta === "number" ? delta : 0;
}

function daysPulledIn(before?: string, after?: string): number {
  // An option that stops an order falling off the horizon entirely is a win we
  // cannot express in days, so treat it as a large but bounded improvement.
  if (!before && after) return 999;
  if (!before || !after) return 0;
  return differenceInCalendarDays(parseISO(before), parseISO(after));
}

/**
 * Confidence reflects how cleanly the simulation came out: a big pull-in that
 * also improves the overall objective is trustworthy, one that helps this order
 * while hurting the factory much less so.
 */
function confidenceFor(result: ScenarioResult, impactDays: number): number {
  let confidence = 0.5 + Math.min(0.3, impactDays * 0.04);
  if (result.diff.scoreDelta < 0) confidence += 0.15;
  if (result.diff.lateOrdersDelta > 0) confidence -= 0.2;
  return Math.round(Math.max(0.1, Math.min(0.95, confidence)) * 100) / 100;
}
