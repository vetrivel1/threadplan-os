"use client";

import { useCallback, useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Gauge,
  GitBranch,
  Info,
  PackageCheck,
  Plus,
  Repeat,
  RotateCcw,
  Ruler,
  Scale,
  SlidersHorizontal,
  TrendingUp,
  UploadCloud,
  Zap,
} from "lucide-react";
import { useScheduleStore } from "@/lib/store/schedule-store";
import { useHydrated } from "@/lib/hooks/use-hydrated";
import {
  Bar,
  Cell,
  EffectNote,
  EngineSection,
  Fraction,
  Pill,
  Row,
  RuleBox,
  Slider,
  Step,
  Table,
  Toggle,
  WorkedExample,
} from "@/components/engine/EnginePrimitives";
import { LearningCurveChart } from "@/components/engine/LearningCurveChart";
import { SCORING_WEIGHTS, type ScoringWeights } from "@/lib/engine/objective";
import { DEFAULT_PHYSICS, type PhysicsOptions } from "@/lib/engine/physics";
import {
  CR_UNRECOVERABLE,
  scoreAllPriorities,
} from "@/lib/engine/priority-score";
import {
  CHANGEOVER_BASE_MINUTES,
  COLOUR_LIGHTNESS,
  COMPLEXITY_SPREAD_MINUTES,
  FABRIC_CHANGE_MINUTES,
  STAGE_CHANGEOVER_WEIGHT,
  changeoverMinutes,
  colourChangeMinutes,
} from "@/lib/engine/changeover";
import {
  COMPLEXITY_TIERS,
  daysToReachEfficiency,
  efficiencyAtDay,
  tierForComplexity,
  type ComplexityTier,
} from "@/lib/engine/complexity";
import {
  RM_BUFFER_DAYS,
  blockingMaterial,
  effectiveRmDate,
} from "@/lib/engine/material-gate";
import {
  SUB_SCALE_RAMP_SHARE,
  VIABILITY_EFFICIENCY_THRESHOLD,
  assessRunSizes,
} from "@/lib/engine/run-size";
import { fitObservedCurves } from "@/lib/engine/learning-fit";
import { computeCriticalPaths } from "@/lib/engine/critical-path";
import { findRmCutoff } from "@/lib/engine/cutoff";
import { suggestMaterialDates } from "@/lib/engine/material-suggestion";
import { optimizeSchedule } from "@/lib/engine/optimizer";
import {
  REPLAN_HORIZON_DAYS,
  SEQUENCE_HORIZON_DAYS,
} from "@/lib/engine/sequencing-policy";
import { STAGE_LABELS, STAGE_ORDER, type StageCode } from "@/lib/types";

type RuleId =
  | "urgency"
  | "material"
  | "comparison"
  | "learning"
  | "changeover"
  | "runSize"
  | "horizon"
  | "outputs";

/** The order rules are listed in until a planner rearranges them. */
const DEFAULT_RULE_ORDER: RuleId[] = [
  "urgency",
  "material",
  "comparison",
  "learning",
  "changeover",
  "runSize",
  "horizon",
  "outputs",
];

interface WeightConfig {
  key: keyof ScoringWeights;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}

/** The seven trade-offs a planner can actually move. Ranges are generous
 * enough to explore, not so wide that a slider is all-or-nothing. */
const WEIGHT_CONFIG: WeightConfig[] = [
  {
    key: "tardiness",
    label: "Lateness",
    hint: "Points per weighted day an order finishes past its deadline.",
    min: 0,
    max: 30,
    step: 1,
  },
  {
    key: "unfinished",
    label: "Unfinished orders",
    hint: "Flat penalty for an order that never finishes inside the horizon.",
    min: 0,
    max: 500,
    step: 10,
  },
  {
    key: "changeover",
    label: "Changeover",
    hint: "Points per hour lost to style or colour changeovers.",
    min: 0,
    max: 5,
    step: 0.1,
  },
  {
    key: "idle",
    label: "Idle capacity",
    hint: "Points per idle line-hour inside the makespan.",
    min: 0,
    max: 0.2,
    step: 0.01,
  },
  {
    key: "churn",
    label: "Churn",
    hint: "Points per order whose position moves against the published plan.",
    min: 0,
    max: 20,
    step: 0.5,
  },
  {
    key: "wip",
    label: "Work in progress",
    hint: "Points per unit-day of stitched stock that cannot close a carton.",
    min: 0,
    max: 0.01,
    step: 0.0005,
    format: (v) => v.toFixed(4),
  },
  {
    key: "throughput",
    label: "Throughput credit",
    hint: "Credit per unit shipped inside the horizon (subtracted from the score).",
    min: 0,
    max: 0.01,
    step: 0.0005,
    format: (v) => v.toFixed(4),
  },
];

interface PhysicsConfig {
  key: keyof PhysicsOptions;
  label: string;
  hint: string;
}

/** Engine fidelity toggles — these change how faithfully the model simulates
 * the floor, not a business trade-off, so they sit behind "Advanced". */
const PHYSICS_CONFIG: PhysicsConfig[] = [
  {
    key: "changeover",
    label: "Style changeover cost",
    hint: "Deduct setup minutes when a line switches style.",
  },
  {
    key: "learningRetention",
    label: "Learning retention",
    hint: "Keep part of the learning curve when a line returns to a style it ran recently.",
  },
  {
    key: "complexityCurves",
    label: "Complexity-driven curves",
    hint: "Derive the learning curve from garment complexity when no measured curve exists.",
  },
  {
    key: "rmBuffer",
    label: "Material buffer + gating",
    hint: "Gate the start date on the latest material plus an inspection buffer.",
  },
  {
    key: "packRatioSequencing",
    label: "Pack-ratio tracking",
    hint: "Track size and colour breakdown so shortfalls and stranded stock are visible.",
  },
  {
    key: "colourChangeover",
    label: "Colour & thread changeover",
    hint: "Charge a rethread cost when a line switches colourway.",
  },
  {
    key: "configuredRouting",
    label: "Style-specific routing",
    hint: "Run each order through its style's route instead of a fixed four stages.",
  },
  {
    key: "perLineRates",
    label: "Per-line rates",
    hint: "Use a style's per-line SMV and learning curve overrides where set.",
  },
];

export default function EnginePage() {
  const {
    orders,
    styles,
    lines,
    learningCurves,
    scoringWeights,
    physicsOverrides,
    currentSequence,
    publishedSequence,
    publishedAt,
    isReplanning,
    lastReplanSummary,
    setScoringWeight,
    setPhysicsOverride,
    resetParameters,
    replan,
    publishPlan,
  } = useScheduleStore();
  const mounted = useHydrated();
  const [ruleOrder, setRuleOrder] = useState<RuleId[]>(DEFAULT_RULE_ORDER);

  const resolvedWeights: ScoringWeights = useMemo(
    () => ({ ...SCORING_WEIGHTS, ...scoringWeights }),
    [scoringWeights]
  );
  const resolvedPhysics: PhysicsOptions = useMemo(
    () => ({ ...DEFAULT_PHYSICS, ...physicsOverrides }),
    [physicsOverrides]
  );
  const hasCustomWeights = Object.keys(scoringWeights).length > 0;
  const hasCustomPhysics = Object.keys(physicsOverrides).length > 0;

  const moveRule = useCallback((id: RuleId, direction: -1 | 1) => {
    setRuleOrder((current) => {
      const from = current.indexOf(id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      next[from] = current[to]!;
      next[to] = id;
      return next;
    });
  }, []);

  /** Position and reorder controls for one rule card. */
  const ruleProps = useCallback(
    (id: RuleId) => {
      const position = ruleOrder.indexOf(id);
      return {
        // Offset past the page headings, which sit at the default order of 0.
        order: position + 1,
        canMoveUp: position > 0,
        canMoveDown: position < ruleOrder.length - 1,
        onMoveUp: () => moveRule(id, -1),
        onMoveDown: () => moveRule(id, 1),
      };
    },
    [ruleOrder, moveRule]
  );

  const orderById = useMemo(
    () => new Map(orders.map((o) => [o.id, o])),
    [orders]
  );

  /** Colours actually on the books, darkest first, so the cleardown reads down-left. */
  const colourScale = useMemo(() => {
    const seen = new Set<string>();
    for (const order of orders) {
      for (const cw of order.colourways ?? []) seen.add(cw.colour);
    }
    return [...seen].sort(
      (a, b) =>
        (COLOUR_LIGHTNESS[a.toLowerCase()] ?? 0.5) -
        (COLOUR_LIGHTNESS[b.toLowerCase()] ?? 0.5)
    );
  }, [orders]);
  // Everything here depends on today's date, so it runs only after hydration to
  // keep the server and first client render identical.
  const engine = useMemo(() => {
    if (!mounted) return null;
    const today = format(new Date(), "yyyy-MM-dd");

    return {
      today,
      run: optimizeSchedule({
        orders,
        styles,
        lines,
        learningCurves,
        startDate: today,
        horizonDays: SEQUENCE_HORIZON_DAYS,
        weights: scoringWeights,
        physics: physicsOverrides,
        referenceSequence: publishedSequence ?? undefined,
      }),
      priorities: scoreAllPriorities({ orders, styles, lines, today }),
      runSizes: assessRunSizes({ orders, styles, lines, learningCurves }),
    };
  }, [
    mounted,
    orders,
    styles,
    lines,
    learningCurves,
    scoringWeights,
    physicsOverrides,
    publishedSequence,
  ]);

  const best = engine?.run.best;
  const baseline = engine?.run.baseline;

  /** Which style×line curves have real recorded output behind them, versus
   * still running on the modelled prior — a planner will ask which is which. */
  const fittedCurves = useMemo(() => {
    if (!engine) return [];
    return fitObservedCurves({
      cells: engine.run.best.output.cells,
      orders,
      styles,
      baseCurves: learningCurves,
    });
  }, [engine, orders, styles, learningCurves]);

  /** Which stage is actually gating each order's finish date. */
  const criticalPaths = useMemo(() => {
    if (!engine) return [];
    return computeCriticalPaths({
      orders,
      styles,
      cells: engine.run.best.output.cells,
    });
  }, [engine, orders, styles]);

  /** One on-time example and one already-late example, so the cutoff search
   * demonstrates both a real boundary and the "no slack left" edge case. */
  const cutoffExamples = useMemo(() => {
    if (!engine) return [];
    const completions = engine.run.best.output.orderCompletions;
    const onTime = orders.find((o) => {
      const c = completions[o.id];
      return c && c <= o.deliveryDeadline;
    });
    const late = orders.find((o) => {
      const c = completions[o.id];
      return c && c > o.deliveryDeadline;
    });
    const targets = [onTime, late].filter(
      (o, i, arr): o is typeof orders[number] =>
        Boolean(o) && arr.findIndex((x) => x?.id === o!.id) === i
    );
    const base = {
      orders,
      styles,
      lines,
      learningCurves,
      startDate: engine.today,
      horizonDays: SEQUENCE_HORIZON_DAYS,
      sequence: engine.run.best.sequence,
      assignmentStrategy: engine.run.best.assignmentStrategy,
    };
    return targets.map((order) => ({
      order,
      cutoff: findRmCutoff({ base, orderId: order.id }),
    }));
  }, [engine, orders, styles, lines, learningCurves]);

  const materialSuggestions = useMemo(() => {
    if (!engine) return [];
    return suggestMaterialDates({ orders, styles, lines, today: engine.today });
  }, [engine, orders, styles, lines]);

  /** Days late per order in the chosen plan, keyed by order id. */
  const daysLateByOrder = useMemo(() => {
    const map = new Map<string, number>();
    if (!engine) return map;

    for (const [orderId, completion] of Object.entries(
      engine.run.best.output.orderCompletions
    )) {
      const order = orderById.get(orderId);
      if (!order || !completion) continue;
      map.set(
        orderId,
        differenceInCalendarDays(
          parseISO(completion),
          parseISO(order.deliveryDeadline)
        )
      );
    }
    return map;
  }, [engine, orderById]);

  /** Most urgent order, used to work the urgency sum through with real numbers. */
  const urgencyExample = useMemo(() => {
    if (!engine || engine.priorities.length === 0) return null;
    const lowest = engine.priorities.reduce((a, b) =>
      b.criticalRatio < a.criticalRatio ? b : a
    );
    return {
      p: lowest,
      order: orderById.get(lowest.orderId),
      // How the order actually turned out, so the example can reconcile the
      // ratio against the plan instead of quietly contradicting it.
      daysLate: daysLateByOrder.get(lowest.orderId) ?? null,
    };
  }, [engine, orderById, daysLateByOrder]);

  /**
   * The scorecard, itemised. Points are rounded for display and the total is
   * the sum of what is shown, so a planner can add the column up by hand and
   * get the same answer.
   */
  const scoreLines = useMemo(() => {
    if (!best) return null;
    const b = best.breakdown;
    const w = resolvedWeights;

    const rows = [
      {
        label: "Finishing after the delivery date",
        unit: `${w.tardiness} per weighted day`,
        weight: w.tardiness,
        measured: b.weightedTardinessDays,
        measuredLabel: `${b.weightedTardinessDays} weighted days`,
      },
      {
        label: "Not finishing inside the planning window at all",
        unit: `${w.unfinished} per order`,
        weight: w.unfinished,
        measured: b.unfinishedOrders,
        measuredLabel: `${b.unfinishedOrders} orders`,
      },
      {
        label: "Time lost changing styles on a line",
        unit: `${w.changeover} per hour`,
        weight: w.changeover,
        measured: b.changeoverHours,
        measuredLabel: `${b.changeoverHours} hours`,
      },
      {
        label: "Lines sitting idle while work is waiting",
        unit: `${w.idle} per hour`,
        weight: w.idle,
        measured: b.idleCapacityHours,
        measuredLabel: `${b.idleCapacityHours.toLocaleString()} hours`,
      },
      {
        label: "Stitched stock that cannot close a carton yet",
        unit: `${w.wip} per piece per day`,
        weight: w.wip,
        measured: b.wipUnitDays,
        measuredLabel: `${b.wipUnitDays.toLocaleString()} piece-days`,
      },
      {
        label: "Moving orders the floor was already told about",
        unit: `${w.churn} per order`,
        weight: w.churn,
        measured: b.churn,
        measuredLabel: `${b.churn} orders`,
      },
      {
        label: "Credit for pieces packed and shipped",
        unit: `${w.throughput} per piece`,
        weight: -w.throughput,
        measured: b.unitsCompleted,
        measuredLabel: `${b.unitsCompleted.toLocaleString()} pieces`,
      },
    ].map((row) => ({
      ...row,
      points: Math.round(row.weight * row.measured * 10) / 10,
    }));

    return {
      rows,
      total: Math.round(rows.reduce((sum, r) => sum + r.points, 0) * 10) / 10,
    };
  }, [best, resolvedWeights]);

  /** An order with a real material breakdown makes the gate rule concrete. */
  const materialExample = useMemo(
    () =>
      orders.find((o) => (o.materials?.length ?? 0) > 1) ?? orders[0] ?? null,
    [orders]
  );

  /** The most expensive style switch, as the worst case worth explaining. */
  const changeoverExample = useMemo(() => {
    let worst:
      | { from: (typeof styles)[number]; to: (typeof styles)[number]; minutes: number }
      | null = null;
    for (const from of styles) {
      for (const to of styles) {
        if (from.id === to.id) continue;
        const minutes = changeoverMinutes(from, to, "sewing");
        if (!worst || minutes > worst.minutes) worst = { from, to, minutes };
      }
    }
    return worst;
  }, [styles]);

  const waitingOnMaterial = useMemo(() => {
    if (!engine) return [];
    return orders.filter((o) => effectiveRmDate(o, true) > engine.today);
  }, [orders, engine]);

  return (
    // Flex column rather than space-y so the rule cards can be resequenced with
    // the CSS order property and still keep even spacing.
    <div className="flex flex-col gap-6 p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          How the Plan Is Decided
        </h1>
        <p className="mt-1.5 max-w-3xl text-muted">
          Auto-Sequence does not simply run orders in delivery-date order. It
          builds several possible plans, works out what each one would cost the
          factory, and keeps the best. This page shows every rule it applies,
          the sum behind it, and what each rule changed in the plan you are
          about to run.
        </p>
        <p className="mt-3 flex items-start gap-2 text-xs text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Rearranging the rule cards below only changes the order you review
          them in. The Planning parameters panel is what actually changes
          today&apos;s plan.
        </p>
      </header>

      <div className="rounded-xl border border-accent/30 bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <SlidersHorizontal className="h-4 w-4 text-accent" />
              Planning parameters
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              These weights are the real trade-offs behind the plan, not just
              this page&apos;s numbers. Move a slider, watch the rules below
              recompute, then Replan to push the result to Auto Plan and
              Auto-Sequence.
            </p>
          </div>
          <button
            type="button"
            onClick={resetParameters}
            disabled={!hasCustomWeights && !hasCustomPhysics}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to defaults
          </button>
        </div>

        <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {WEIGHT_CONFIG.map((cfg) => (
            <Slider
              key={cfg.key}
              label={cfg.label}
              hint={cfg.hint}
              value={resolvedWeights[cfg.key]}
              defaultValue={SCORING_WEIGHTS[cfg.key]}
              min={cfg.min}
              max={cfg.max}
              step={cfg.step}
              format={cfg.format}
              onChange={(v) => setScoringWeight(cfg.key, v)}
            />
          ))}
        </div>

        <details className="group mt-5 rounded-lg border border-border-subtle">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2">
              Advanced: engine fidelity
              {hasCustomPhysics && <Pill label="modified" tone="accent" />}
            </span>
            <ChevronDown className="h-4 w-4 text-muted transition-transform duration-200 group-open:rotate-180" />
          </summary>
          <div className="grid gap-x-8 gap-y-0.5 border-t border-border-subtle px-4 py-2 sm:grid-cols-2">
            {PHYSICS_CONFIG.map((cfg) => (
              <Toggle
                key={cfg.key}
                label={cfg.label}
                hint={cfg.hint}
                checked={resolvedPhysics[cfg.key]}
                onChange={(v) => setPhysicsOverride(cfg.key, v)}
              />
            ))}
          </div>
        </details>

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
          <button
            type="button"
            onClick={replan}
            disabled={isReplanning}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            <Zap className="h-4 w-4" />
            {isReplanning
              ? "Replanning…"
              : "Replan Auto Plan & Auto-Sequence"}
          </button>
          <button
            type="button"
            onClick={publishPlan}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-accent/40"
          >
            <UploadCloud className="h-4 w-4" />
            Publish this plan
          </button>
          <p className="text-xs text-muted">
            {publishedAt ? (
              <>
                Published {publishedSequence?.length ?? 0} orders at{" "}
                {format(parseISO(publishedAt), "MMM d, h:mma")}.{" "}
                {currentSequence &&
                publishedSequence &&
                currentSequence.join("|") !== publishedSequence.join("|")
                  ? "The live plan has moved since — Replan to see the churn cost, or Publish again to reset the baseline."
                  : "The live plan matches what was published."}
              </>
            ) : (
              "Not yet published — churn has nothing to be measured against."
            )}
          </p>
        </div>

        {lastReplanSummary && (
          <div className="mt-4">
            <EffectNote>
              Replanned with these settings: score improved by{" "}
              {Math.round(lastReplanSummary.improvement)} points versus plain
              delivery-date order, late orders{" "}
              {lastReplanSummary.lateOrdersBefore} →{" "}
              {lastReplanSummary.lateOrdersAfter}
              {lastReplanSummary.churn > 0 && (
                <>
                  , {lastReplanSummary.churn} order
                  {lastReplanSummary.churn === 1 ? "" : "s"} moved against the
                  published plan
                </>
              )}
              . Evaluated {lastReplanSummary.evaluated} candidates in{" "}
              {lastReplanSummary.elapsedMs}ms.
            </EffectNote>
          </div>
        )}
      </div>

      {!engine || !best || !baseline ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-sm text-muted">
          Working out today&apos;s plan…
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Planning rules</h2>
              <p className="mt-0.5 max-w-2xl text-sm text-muted">
                {ruleOrder.length} rules are applied every time Auto-Sequence
                runs. Open one to see the sum behind it and what it changed
                today, or use the arrows to arrange them in the order you want
                them reviewed.
              </p>
            </div>
            <button
              type="button"
              title="Coming soon"
              className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:border-accent/40 hover:text-foreground"
            >
              <Plus className="h-4 w-4" />
              Add Rule
            </button>
          </div>

          <EngineSection
            icon={Gauge}
            {...ruleProps("urgency")}
            title="How urgent is each order?"
            question="Two orders are both due soon. Which one genuinely needs the line first?"
          >
            <Step label="The rule">
              <RuleBox>
                <p className="mb-3">
                  Comparing delivery dates alone is misleading, because a big
                  order needs far more time than a small one. So each order is
                  scored on how much time it has left against how much work it
                  still needs:
                </p>
                <Fraction
                  top="Days until delivery is due"
                  bottom="Days of work still needed"
                />
                <ul className="mt-3 space-y-1">
                  <li>
                    <strong>Above 1.0</strong> — there is more time than work.
                    Comfortable.
                  </li>
                  <li>
                    <strong>Below 1.0</strong> — there is less time than work.
                    This order needs to move up the queue.
                  </li>
                  <li>
                    <strong>Below {CR_UNRECOVERABLE}</strong> — so far behind
                    that no amount of reordering saves it. Moving it up would
                    only make other orders late too, so it is flagged for a
                    delivery-date conversation with the customer instead.
                  </li>
                </ul>
              </RuleBox>
            </Step>

            {urgencyExample?.order && (
              <Step label="Worked through on your most urgent order">
                <WorkedExample title={urgencyExample.order.orderNumber}>
                  <p>
                    Delivery is due in{" "}
                    <strong className="text-foreground">
                      {urgencyExample.p.daysUntilDue} days
                    </strong>
                    . Across knitting, cutting, sewing and packing this order
                    needs about{" "}
                    <strong className="text-foreground">
                      {urgencyExample.p.remainingLeadDays} days
                    </strong>{" "}
                    of work, including the slower first days on a new style.
                  </p>
                  <div className="py-1">
                    <Fraction
                      top={`${urgencyExample.p.daysUntilDue} days until due`}
                      bottom={`${urgencyExample.p.remainingLeadDays} days of work`}
                      result={String(urgencyExample.p.criticalRatio)}
                    />
                  </div>
                  <p>
                    {urgencyExample.p.criticalRatio >= 1
                      ? `On paper that leaves ${urgencyExample.p.slackDays} days of spare time, so on this measure alone it does not need to jump the queue.`
                      : "That is under 1.0, so it is already behind and needs the line before less urgent work."}
                  </p>
                  {urgencyExample.daysLate != null &&
                    urgencyExample.daysLate > 0 && (
                      <p className="border-t border-border-subtle pt-2">
                        In the finished plan it still comes out{" "}
                        <strong className="text-warning">
                          {urgencyExample.daysLate} days late
                        </strong>
                        . That is not a contradiction: this sum assumes the order
                        has the lines to itself, and in the real plan it queues
                        behind other work. It is exactly why the finish dates
                        come from simulating the whole plan rather than from this
                        ratio.
                      </p>
                    )}
                </WorkedExample>
              </Step>
            )}

            <Step label="Every order, scored the same way">
              <Table
                columns={[
                  { label: "Order" },
                  { label: "Due in", align: "right", hint: "days" },
                  { label: "Work needs", align: "right", hint: "days" },
                  { label: "Spare time", align: "right", hint: "days" },
                  { label: "Urgency", align: "right" },
                  { label: "Verdict" },
                ]}
                minWidth={620}
              >
                {[...engine.priorities]
                  .sort((a, b) => a.criticalRatio - b.criticalRatio)
                  .map((p) => (
                    <Row key={p.orderId}>
                      <Cell strong>
                        {orderById.get(p.orderId)?.orderNumber ?? p.orderId}
                      </Cell>
                      <Cell align="right" tone="muted">
                        {p.daysUntilDue}
                      </Cell>
                      <Cell align="right" tone="muted">
                        {p.remainingLeadDays}
                      </Cell>
                      <Cell
                        align="right"
                        tone={p.slackDays < 0 ? "bad" : "muted"}
                      >
                        {p.slackDays}
                      </Cell>
                      <Cell align="right" strong>
                        {p.criticalRatio}
                      </Cell>
                      <Cell>
                        {p.bucket === "replan_delivery" ? (
                          <Pill label="Renegotiate delivery" tone="bad" />
                        ) : p.bucket === "critical" ? (
                          <Pill label="Behind — move up" tone="warn" />
                        ) : (
                          <Pill label="Enough time" tone="good" />
                        )}
                      </Cell>
                    </Row>
                  ))}
              </Table>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                This sum assumes an order gets every line in a stage to itself.
                An order can therefore show spare time here and still finish
                late once it is queued behind others — the finish dates in the
                table above are the ones to trust.
              </p>
            </Step>
          </EngineSection>

          <EngineSection
            icon={PackageCheck}
            {...ruleProps("material")}
            title="Is the material actually ready?"
            question="An order is urgent, but the fabric has not landed. What does the plan do with it?"
            accent="text-cutting"
          >
            <Step label="The rule">
              <RuleBox>
                <p>
                  Urgency never overrides material. An order cannot start until
                  its <strong>last</strong> material arrives — not its first —
                  plus {RM_BUFFER_DAYS} day for inspection and issue to the
                  floor.
                </p>
                <p className="mt-2 font-medium">
                  Earliest start = latest material arrival + {RM_BUFFER_DAYS} day
                </p>
                <p className="mt-2">
                  Starting an order early would only starve the line, so orders
                  waiting on material are held back however urgent they look.
                </p>
              </RuleBox>
            </Step>

            {materialExample && (
              <Step label="Worked through on a real order">
                <WorkedExample title={materialExample.orderNumber}>
                  {materialExample.materials &&
                  materialExample.materials.length > 0 ? (
                    <>
                      <ul className="space-y-1">
                        {materialExample.materials.map((m) => (
                          <li
                            key={m.name}
                            className="flex justify-between gap-4"
                          >
                            <span>{m.name}</span>
                            <span className="text-foreground">
                              {format(parseISO(m.inHouseDate), "MMM d")}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="border-t border-border-subtle pt-2">
                        The last one to arrive is{" "}
                        <strong className="text-foreground">
                          {blockingMaterial(materialExample)}
                        </strong>
                        , so that is what the order waits on. Add{" "}
                        {RM_BUFFER_DAYS} day for inspection and this order can
                        start from{" "}
                        <strong className="text-accent-hover">
                          {format(
                            parseISO(effectiveRmDate(materialExample, true)),
                            "MMM d"
                          )}
                        </strong>
                        .
                      </p>
                    </>
                  ) : (
                    <p>
                      This order has a single material date of{" "}
                      {format(
                        parseISO(materialExample.rmInHouseDate),
                        "MMM d"
                      )}
                      , so it can start from{" "}
                      <strong className="text-accent-hover">
                        {format(
                          parseISO(effectiveRmDate(materialExample, true)),
                          "MMM d"
                        )}
                      </strong>{" "}
                      once inspection is allowed for.
                    </p>
                  )}
                </WorkedExample>
              </Step>
            )}

            <Step label="Every order's earliest start">
              <Table
                columns={[
                  { label: "Order" },
                  { label: "Materials tracked", align: "right" },
                  { label: "Last to arrive" },
                  { label: "Can start" },
                  { label: "Status" },
                ]}
                minWidth={620}
              >
                {orders.map((order) => {
                  const gate = effectiveRmDate(order, true);
                  const waitDays = differenceInCalendarDays(
                    parseISO(gate),
                    parseISO(engine.today)
                  );
                  return (
                    <Row key={order.id}>
                      <Cell strong>{order.orderNumber}</Cell>
                      <Cell align="right" tone="muted">
                        {order.materials?.length ?? 1}
                      </Cell>
                      <Cell tone="muted">
                        {blockingMaterial(order) ?? "Single material date"}
                      </Cell>
                      <Cell tone="accent">
                        {format(parseISO(gate), "MMM d")}
                      </Cell>
                      <Cell>
                        {waitDays > 0 ? (
                          <Pill
                            label={`Waiting ${waitDays} more day${waitDays === 1 ? "" : "s"}`}
                            tone="warn"
                          />
                        ) : (
                          <Pill label="In house" tone="good" />
                        )}
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            </Step>

            <EffectNote>
              {waitingOnMaterial.length === 0 ? (
                <>
                  Every order has its material in house, so nothing was held
                  back for material today.
                </>
              ) : (
                <>
                  {waitingOnMaterial.length} order
                  {waitingOnMaterial.length === 1 ? " is" : "s are"} still
                  waiting on material (
                  {waitingOnMaterial.map((o) => o.orderNumber).join(", ")}), so
                  {waitingOnMaterial.length === 1 ? " it was" : " they were"}{" "}
                  held back regardless of urgency. No line is planned to sit
                  idle waiting for fabric.
                </>
              )}
            </EffectNote>
          </EngineSection>

          <EngineSection
            icon={Scale}
            {...ruleProps("comparison")}
            title="How two plans are compared"
            question="One plan finishes an order sooner but needs more changeovers. How does the system decide which is better?"
            accent="text-accent"
          >
            <Step label="The rule">
              <RuleBox>
                <p>
                  Every candidate plan is given penalty points for the things a
                  factory wants to avoid, and credit for units shipped. The plan
                  with the <strong>lowest total</strong> wins. This is what lets
                  the system trade one problem against another instead of
                  chasing a single number.
                </p>
                <p className="mt-2">
                  Because a day of lateness costs {resolvedWeights.tardiness}{" "}
                  points and an hour of changeover costs{" "}
                  {resolvedWeights.changeover}, the system will accept up to
                  about{" "}
                  {Math.round(
                    (resolvedWeights.tardiness / resolvedWeights.changeover) *
                      10
                  ) / 10}{" "}
                  extra hours of changeover to pull one day of lateness back.
                  That exchange rate is set under Planning parameters above —
                  it is the business decision behind the plan, not a fixed
                  constant.
                </p>
              </RuleBox>
            </Step>

            <Step label="Today's plan, itemised">
              <Table
                columns={[
                  { label: "What gets penalised" },
                  { label: "Cost each", align: "right" },
                  { label: "This plan has", align: "right" },
                  { label: "Points", align: "right" },
                ]}
                minWidth={620}
              >
                {(scoreLines?.rows ?? []).map((line) => (
                  <Row key={line.label}>
                    <Cell>{line.label}</Cell>
                    <Cell align="right" tone="muted">
                      {line.unit}
                    </Cell>
                    <Cell align="right" tone="muted">
                      {line.measuredLabel}
                    </Cell>
                    <Cell
                      align="right"
                      strong
                      tone={line.points < 0 ? "good" : "default"}
                    >
                      {line.points > 0 ? `+${line.points}` : line.points}
                    </Cell>
                  </Row>
                ))}
                <Row>
                  <Cell className="bg-surface-elevated" strong>
                    Total penalty for this plan
                  </Cell>
                  <Cell className="bg-surface-elevated" />
                  <Cell className="bg-surface-elevated" />
                  <Cell
                    className="bg-surface-elevated"
                    align="right"
                    strong
                    tone="accent"
                  >
                    {scoreLines?.total ?? 0}
                  </Cell>
                </Row>
              </Table>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Days late are weighted by how important the order is, so missing
                a priority customer counts for more than missing a filler order.
                This plan is {best.breakdown.rawTardinessDays} actual days late
                across {best.breakdown.lateOrders} order
                {best.breakdown.lateOrders === 1 ? "" : "s"}, which counts as{" "}
                {best.breakdown.weightedTardinessDays} weighted days above.
              </p>
            </Step>

            <EffectNote>
              {engine.run.evaluated} plans were costed this way before one was
              chosen. The winner comes out {Math.round(engine.run.improvement)}{" "}
              points better than running the orders in plain delivery-date order
              — mostly by taking late orders from{" "}
              {baseline.breakdown.lateOrders} down to{" "}
              {best.breakdown.lateOrders}.
            </EffectNote>
          </EngineSection>

          <EngineSection
            icon={TrendingUp}
            {...ruleProps("learning")}
            title="Operators are slower on a new style"
            question="Why does the plan give a complex garment less output in its first few days?"
            accent="text-knitting"
          >
            <Step label="The rule">
              <RuleBox>
                <p>
                  Nobody hits target output on day one of a new style. The plan
                  assumes a line starts below its normal speed and climbs day by
                  day, and how far below depends on how complicated the garment
                  is. A basic tee is close to normal within a couple of days; a
                  complex jacket takes a week.
                </p>
                <p className="mt-2">
                  Complexity only affects how long the climb takes — not the
                  final speed. The minutes per piece at full speed already come
                  from the style&apos;s SMV.
                </p>
              </RuleBox>
            </Step>

            <div className="grid gap-6 lg:grid-cols-2">
              <Step label="The climb to full speed">
                <LearningCurveChart />
              </Step>

              <Step label="Day-by-day output, as a share of normal">
                <Table
                  columns={[
                    { label: "Garment type" },
                    { label: "Day 1", align: "right" },
                    { label: "Day 3", align: "right" },
                    { label: "Day 5", align: "right" },
                    { label: "Up to speed", align: "right", hint: "days" },
                  ]}
                >
                  {(Object.keys(COMPLEXITY_TIERS) as ComplexityTier[]).map(
                    (tier) => {
                      const { curve, label } = COMPLEXITY_TIERS[tier];
                      const inTier = styles.filter(
                        (s) => tierForComplexity(s.complexity) === tier
                      );
                      return (
                        <Row key={tier}>
                          <Cell>
                            <span className="font-medium">{label}</span>
                            <span className="mt-0.5 block text-xs text-muted">
                              {inTier.length === 0
                                ? "no styles in this group"
                                : inTier.map((s) => s.name).join(", ")}
                            </span>
                          </Cell>
                          <Cell align="right" tone="accent" strong>
                            {Math.round(efficiencyAtDay(curve, 1) * 100)}%
                          </Cell>
                          <Cell align="right" tone="muted">
                            {Math.round(efficiencyAtDay(curve, 3) * 100)}%
                          </Cell>
                          <Cell align="right" tone="muted">
                            {Math.round(efficiencyAtDay(curve, 5) * 100)}%
                          </Cell>
                          <Cell align="right" tone="muted">
                            {Math.ceil(
                              daysToReachEfficiency(
                                curve,
                                VIABILITY_EFFICIENCY_THRESHOLD
                              )
                            )}
                          </Cell>
                        </Row>
                      );
                    }
                  )}
                </Table>
              </Step>
            </div>

            <EffectNote>
              The plan also remembers what a line ran recently. If a line comes
              back to a style it made not long ago, it keeps part of that
              learning instead of starting from day one again — so repeat orders
              are planned at a realistic output rather than a pessimistic one.
            </EffectNote>

            <Step label="Measured vs. modelled">
              <RuleBox>
                {fittedCurves.length === 0 ? (
                  <p>
                    No style-on-a-line pairing has recorded actual output yet,
                    so every curve above is the modelled prior — a reasonable
                    starting guess, not a measurement. Recording an actual
                    quantity through a ripple edit is what turns a modelled
                    curve into a measured one.
                  </p>
                ) : (
                  <>
                    <p>
                      {fittedCurves.length} style-on-a-line pairing
                      {fittedCurves.length === 1 ? " has" : "s have"} recorded
                      output behind them; every other curve above is still the
                      modelled prior.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {fittedCurves.map((fit) => {
                        const style = styles.find((s) => s.id === fit.styleId);
                        const line = lines.find((l) => l.id === fit.lineId);
                        const direction = fit.bias >= 1 ? "ahead of" : "behind";
                        return (
                          <li key={fit.key} className="text-xs text-muted">
                            <span className="font-medium text-foreground">
                              {style?.name ?? fit.styleId}
                            </span>{" "}
                            on {line?.name ?? fit.lineId}: {fit.observationCount}{" "}
                            recorded day{fit.observationCount === 1 ? "" : "s"},
                            running {Math.abs(Math.round((fit.bias - 1) * 100))}%{" "}
                            {direction} the model (trusted{" "}
                            {Math.round(fit.shrinkage * 100)}% over the prior).
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </RuleBox>
            </Step>
          </EngineSection>

          <EngineSection
            icon={Repeat}
            {...ruleProps("changeover")}
            title="Changing style on a line costs time"
            question="Why does the plan sometimes keep similar styles together instead of following delivery dates exactly?"
            accent="text-sewing"
          >
            <Step label="The rule">
              <RuleBox>
                <p className="mb-2">
                  Every style change stops the line. Until measured changeover
                  times are available per line, the plan estimates the loss from
                  what is already on file — how different the two garments are,
                  and whether the fabric changes:
                </p>
                <p className="font-medium">
                  {CHANGEOVER_BASE_MINUTES} min to stop and re-set
                  {" + "}
                  {COMPLEXITY_SPREAD_MINUTES} min per step of difference in
                  garment complexity
                  {" + "}
                  {FABRIC_CHANGE_MINUTES} min if the fabric changes
                </p>
                <p className="mt-2">
                  That total is then scaled by stage, because not every stage is
                  equally hard to re-set:{" "}
                  {STAGE_ORDER.filter((s) =>
                    lines.some((l) => l.stage === s)
                  )
                    .map(
                      (s) =>
                        `${STAGE_LABELS[s]} ${Math.round(STAGE_CHANGEOVER_WEIGHT[s] * 100)}%`
                    )
                    .join(", ")}
                  .
                </p>
              </RuleBox>
            </Step>

            {changeoverExample && (
              <Step label="Worked through on your most expensive switch">
                <WorkedExample
                  title={`Sewing: ${changeoverExample.from.name} → ${changeoverExample.to.name}`}
                >
                  <div className="space-y-1">
                    <div className="flex justify-between gap-4">
                      <span>Stopping and re-setting the line</span>
                      <span className="text-foreground">
                        {CHANGEOVER_BASE_MINUTES} min
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>
                        Complexity difference (
                        {changeoverExample.from.complexity} vs{" "}
                        {changeoverExample.to.complexity})
                      </span>
                      <span className="text-foreground">
                        {Math.round(
                          Math.abs(
                            changeoverExample.from.complexity -
                              changeoverExample.to.complexity
                          ) *
                            COMPLEXITY_SPREAD_MINUTES *
                            10
                        ) / 10}{" "}
                        min
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span>
                        Fabric change
                        {changeoverExample.from.fabricType &&
                        changeoverExample.to.fabricType
                          ? ` (${changeoverExample.from.fabricType} → ${changeoverExample.to.fabricType})`
                          : ""}
                      </span>
                      <span className="text-foreground">
                        {changeoverExample.from.fabricType &&
                        changeoverExample.to.fabricType &&
                        changeoverExample.from.fabricType !==
                          changeoverExample.to.fabricType
                          ? `${FABRIC_CHANGE_MINUTES} min`
                          : "none"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-border-subtle pt-2">
                      <span className="text-foreground">
                        Sewing time lost on the switch
                      </span>
                      <span className="font-semibold text-accent-hover">
                        {changeoverExample.minutes} min (
                        {Math.round((changeoverExample.minutes / 60) * 10) / 10}{" "}
                        hours)
                      </span>
                    </div>
                  </div>
                </WorkedExample>
              </Step>
            )}

            <Step label="Sewing time lost on every possible switch">
              <Table
                columns={[
                  { label: "Coming off ↓  /  Going on →" },
                  ...styles.map((s) => ({
                    label: s.name,
                    align: "right" as const,
                  })),
                ]}
                minWidth={560}
              >
                {styles.map((from) => (
                  <Row key={from.id}>
                    <Cell strong>
                      {from.name}
                      <span className="mt-0.5 block text-xs text-muted">
                        {from.fabricType ?? "fabric not recorded"}
                      </span>
                    </Cell>
                    {styles.map((to) => {
                      const minutes = changeoverMinutes(from, to, "sewing");
                      return (
                        <Cell
                          key={to.id}
                          align="right"
                          tone={
                            minutes === 0
                              ? "good"
                              : minutes >= 85
                                ? "warn"
                                : "muted"
                          }
                        >
                          {minutes === 0 ? "no change" : `${minutes} min`}
                        </Cell>
                      );
                    })}
                  </Row>
                ))}
              </Table>
            </Step>

            <Step label="Changing colour costs time too">
              <RuleBox>
                <p className="mb-2">
                  A line is threaded for one colour at a time, so switching
                  colourway inside an order stops it just as a style change
                  does. The cost is not the same in both directions: putting a
                  light shade on after a dark one needs the machine cleared
                  down first, while going dark after light does not.
                </p>
              </RuleBox>
              <Table
                columns={[
                  { label: "Coming off ↓  /  Going on →" },
                  ...colourScale.map((c) => ({
                    label: c,
                    align: "right" as const,
                  })),
                ]}
                minWidth={560}
              >
                {colourScale.map((from) => (
                  <Row key={from}>
                    <Cell strong>{from}</Cell>
                    {colourScale.map((to) => {
                      const minutes = colourChangeMinutes(
                        { colour: from },
                        { colour: to },
                        "sewing"
                      );
                      return (
                        <Cell
                          key={to}
                          align="right"
                          tone={
                            minutes === 0
                              ? "good"
                              : minutes >= 55
                                ? "warn"
                                : "muted"
                          }
                        >
                          {minutes === 0 ? "no change" : `${minutes} min`}
                        </Cell>
                      );
                    })}
                  </Row>
                ))}
              </Table>
            </Step>

            <EffectNote>
              Today&apos;s plan gives up {best.breakdown.changeoverHours} hours
              to style and colour changes together. That is counted as a real
              cost, so grouping similar work is only chosen when it does not
              push an order past its delivery date.
            </EffectNote>
          </EngineSection>

          <EngineSection
            icon={Ruler}
            {...ruleProps("runSize")}
            title="Some orders are too small to get up to speed"
            question="This order is only a few thousand pieces. Will the line ever reach normal output on it?"
            accent="text-warning"
          >
            <Step label="The rule">
              <RuleBox>
                <p>
                  A line climbing to full speed only pays that time back over a
                  long enough run. If an order finishes while operators are
                  still learning it, the factory never sees normal output on it
                  and the setup is wasted.
                </p>
                <p className="mt-2">
                  So each order is checked for how much of it gets made before
                  the line reaches{" "}
                  {Math.round(VIABILITY_EFFICIENCY_THRESHOLD * 100)}% of normal
                  speed. If that is more than{" "}
                  {Math.round(SUB_SCALE_RAMP_SHARE * 100)}% of the order, it is
                  flagged so you can combine it with another order of the same
                  style or move it to a small-batch line.
                </p>
              </RuleBox>
            </Step>

            <Step label="Every order, checked">
              <div className="space-y-2">
                {engine.runSizes.map((a) => (
                  <div
                    key={a.orderId}
                    className={
                      a.subScale
                        ? "rounded-lg border border-warning/30 bg-warning/5 p-4"
                        : "rounded-lg border border-border-subtle bg-surface-elevated p-4"
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {a.subScale ? (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                        )}
                        <span className="text-sm font-medium">
                          {a.orderNumber}
                        </span>
                        <span className="text-xs text-muted">
                          {a.quantity.toLocaleString()} pieces
                        </span>
                      </div>
                      <span className="text-xs text-muted">
                        {Math.round(a.rampShare * 100)}% made before reaching
                        full speed · takes {a.daysToReachThreshold} days to get
                        there
                      </span>
                    </div>
                    <div className="mt-2">
                      <Bar
                        fraction={a.rampShare}
                        tone={a.subScale ? "warning" : "success"}
                      />
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {a.recommendation ??
                        "Long enough that the line reaches normal output well before the order finishes. No action needed."}
                    </p>
                  </div>
                ))}
              </div>
            </Step>
          </EngineSection>

          <EngineSection
            icon={Clock}
            {...ruleProps("horizon")}
            title="How far ahead the plan looks"
            question="How much of the future does each step actually calculate?"
          >
            <Table
              columns={[
                { label: "Step" },
                { label: "Looks ahead", align: "right" },
                { label: "Why" },
              ]}
              minWidth={560}
            >
              <Row>
                <Cell strong>Auto-Sequence</Cell>
                <Cell align="right" tone="accent">
                  {SEQUENCE_HORIZON_DAYS} days
                </Cell>
                <Cell tone="muted">
                  Enough to place every order currently on the books.
                </Cell>
              </Row>
              <Row>
                <Cell strong>Auto Plan replan</Cell>
                <Cell align="right" tone="accent">
                  {REPLAN_HORIZON_DAYS} days
                </Cell>
                <Cell tone="muted">
                  Longer, because locking a shortfall today can push work well
                  past the original window.
                </Cell>
              </Row>
            </Table>
          </EngineSection>

          <EngineSection
            icon={GitBranch}
            {...ruleProps("outputs")}
            title="Three things the plan doesn't tell you yet"
            question="What is the schedule not saying, that a planner still has to work out by hand?"
          >
            <Step label="Critical path — which stage is actually gating each order">
              <RuleBox>
                <p>
                  Every route here runs strictly in order, so there is no
                  branch to compare — the question is where slack disappears.
                  A stage that started the moment it possibly could is on the
                  critical chain; one that queued behind a busy line was never
                  the bottleneck, and speeding up whatever came before it would
                  not have helped.
                </p>
              </RuleBox>
              <div className="mt-3 space-y-2">
                {criticalPaths.map((cp) => {
                  const order = orderById.get(cp.orderId);
                  if (!order) return null;
                  return (
                    <div
                      key={cp.orderId}
                      className="rounded-lg border border-border-subtle bg-surface-2 p-3 text-sm"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{order.orderNumber}</span>
                        <span className="text-xs text-muted">
                          completes {cp.completion ?? "beyond horizon"}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        critical chain:{" "}
                        <span className="text-foreground">
                          {cp.criticalChain
                            .map((s: StageCode) => STAGE_LABELS[s])
                            .join(" → ") || "none scheduled"}
                        </span>
                        {cp.totalQueueDelayDays > 0 && (
                          <span>
                            {" "}
                            · {cp.totalQueueDelayDays} line-queue day
                            {cp.totalQueueDelayDays === 1 ? "" : "s"} elsewhere
                            in the route
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Step>

            <Step label="Cut-off warning — how much slack is really left">
              <RuleBox>
                <p>
                  Binary-searches the same what-if a fabric delay already
                  answers, instead of a planner guessing at how many days of
                  slack an order actually has before its material has to be on
                  time.
                </p>
              </RuleBox>
              <Table
                columns={[
                  { label: "Order" },
                  { label: "Max absorbable", align: "right", hint: "days" },
                  { label: "Cutoff date", align: "right" },
                ]}
                minWidth={480}
              >
                {cutoffExamples.map(({ order, cutoff }) => (
                  <Row key={order.id}>
                    <Cell strong>{order.orderNumber}</Cell>
                    <Cell
                      align="right"
                      tone={cutoff.maxAbsorbableDays < 0 ? "bad" : "muted"}
                    >
                      {cutoff.maxAbsorbableDays < 0
                        ? "none left"
                        : `${cutoff.maxAbsorbableDays}d`}
                    </Cell>
                    <Cell align="right" tone="muted">
                      {cutoff.cutoffDate ?? "already tight"}
                    </Cell>
                  </Row>
                ))}
              </Table>
            </Step>

            <Step label="Suggested material in-house dates — a backward pass from the deadline">
              <RuleBox>
                <p>
                  Independent of the {SEQUENCE_HORIZON_DAYS}-day planning
                  horizon on purpose — this is what answers procuring yarn for
                  panels that will not be knitted for months, long before that
                  order would ever appear in a forward-scheduled plan.
                </p>
              </RuleBox>
              <Table
                columns={[
                  { label: "Order" },
                  { label: "Deadline", align: "right" },
                  { label: "Suggested RM date", align: "right" },
                  { label: "Days from now", align: "right" },
                ]}
                minWidth={560}
              >
                {materialSuggestions.map((s) => {
                  const order = orderById.get(s.orderId);
                  if (!order) return null;
                  return (
                    <Row key={s.orderId}>
                      <Cell strong>{order.orderNumber}</Cell>
                      <Cell align="right" tone="muted">
                        {s.deliveryDeadline}
                      </Cell>
                      <Cell align="right" tone="accent">
                        {s.suggestedInHouseDate}
                      </Cell>
                      <Cell
                        align="right"
                        tone={s.daysUntilNeeded < 0 ? "bad" : "muted"}
                      >
                        {s.daysUntilNeeded}
                      </Cell>
                    </Row>
                  );
                })}
              </Table>
            </Step>

            <EffectNote>
              None of these three change what gets scheduled — they read the
              same plan the rest of this page already computed and answer
              questions a planner would otherwise have to work out by hand.
            </EffectNote>
          </EngineSection>
        </>
      )}
    </div>
  );
}
