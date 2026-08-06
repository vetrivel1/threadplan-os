"use client";

import { useCallback, useMemo, useState } from "react";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  Info,
  PackageCheck,
  Plus,
  Repeat,
  Ruler,
  Scale,
  TrendingUp,
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
  Step,
  Table,
  WorkedExample,
} from "@/components/engine/EnginePrimitives";
import { LearningCurveChart } from "@/components/engine/LearningCurveChart";
import { SCORING_WEIGHTS } from "@/lib/engine/objective";
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
import { optimizeSchedule } from "@/lib/engine/optimizer";
import {
  REPLAN_HORIZON_DAYS,
  SEQUENCE_HORIZON_DAYS,
} from "@/lib/engine/sequencing-policy";
import { STAGE_ORDER } from "@/lib/types";

type RuleId =
  | "urgency"
  | "material"
  | "comparison"
  | "learning"
  | "changeover"
  | "runSize"
  | "horizon";

/** The order rules are listed in until a planner rearranges them. */
const DEFAULT_RULE_ORDER: RuleId[] = [
  "urgency",
  "material",
  "comparison",
  "learning",
  "changeover",
  "runSize",
  "horizon",
];

const STAGE_LABEL: Record<string, string> = {
  knitting: "Knitting",
  cutting: "Cutting",
  sewing: "Sewing",
  packing: "Packing",
};

export default function EnginePage() {
  const { orders, styles, lines, learningCurves } = useScheduleStore();
  const mounted = useHydrated();
  const [ruleOrder, setRuleOrder] = useState<RuleId[]>(DEFAULT_RULE_ORDER);

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
      }),
      priorities: scoreAllPriorities({ orders, styles, lines, today }),
      runSizes: assessRunSizes({ orders, styles, lines, learningCurves }),
    };
  }, [mounted, orders, styles, lines, learningCurves]);

  const best = engine?.run.best;
  const baseline = engine?.run.baseline;

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

    const rows = [
      {
        label: "Finishing after the delivery date",
        unit: `${SCORING_WEIGHTS.tardiness} per weighted day`,
        weight: SCORING_WEIGHTS.tardiness,
        measured: b.weightedTardinessDays,
        measuredLabel: `${b.weightedTardinessDays} weighted days`,
      },
      {
        label: "Not finishing inside the planning window at all",
        unit: `${SCORING_WEIGHTS.unfinished} per order`,
        weight: SCORING_WEIGHTS.unfinished,
        measured: b.unfinishedOrders,
        measuredLabel: `${b.unfinishedOrders} orders`,
      },
      {
        label: "Time lost changing styles on a line",
        unit: `${SCORING_WEIGHTS.changeover} per hour`,
        weight: SCORING_WEIGHTS.changeover,
        measured: b.changeoverHours,
        measuredLabel: `${b.changeoverHours} hours`,
      },
      {
        label: "Lines sitting idle while work is waiting",
        unit: `${SCORING_WEIGHTS.idle} per hour`,
        weight: SCORING_WEIGHTS.idle,
        measured: b.idleCapacityHours,
        measuredLabel: `${b.idleCapacityHours.toLocaleString()} hours`,
      },
      {
        label: "Stitched stock that cannot close a carton yet",
        unit: `${SCORING_WEIGHTS.wip} per piece per day`,
        weight: SCORING_WEIGHTS.wip,
        measured: b.wipUnitDays,
        measuredLabel: `${b.wipUnitDays.toLocaleString()} piece-days`,
      },
      {
        label: "Moving orders the floor was already told about",
        unit: `${SCORING_WEIGHTS.churn} per order`,
        weight: SCORING_WEIGHTS.churn,
        measured: b.churn,
        measuredLabel: `${b.churn} orders`,
      },
      {
        label: "Credit for pieces packed and shipped",
        unit: `${SCORING_WEIGHTS.throughput} per piece`,
        weight: -SCORING_WEIGHTS.throughput,
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
  }, [best]);

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
          Rule settings are fixed in this build. Rearranging the rules changes
          the order you review them in, not how today&apos;s plan was worked out.
        </p>
      </header>

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
                  Because a day of lateness costs {SCORING_WEIGHTS.tardiness}{" "}
                  points and an hour of changeover costs{" "}
                  {SCORING_WEIGHTS.changeover}, the system will accept up to
                  about{" "}
                  {Math.round(
                    (SCORING_WEIGHTS.tardiness / SCORING_WEIGHTS.changeover) * 10
                  ) / 10}{" "}
                  extra hours of changeover to pull one day of lateness back.
                  That exchange rate is the business decision behind the plan.
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
                  {STAGE_ORDER.map(
                    (s) =>
                      `${STAGE_LABEL[s]} ${Math.round(STAGE_CHANGEOVER_WEIGHT[s] * 100)}%`
                  ).join(", ")}
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
        </>
      )}
    </div>
  );
}
