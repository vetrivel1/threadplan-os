import Link from "next/link";
import { ArrowLeft, FileCode2 } from "lucide-react";
import {
  Cell,
  Formula,
  Glossary,
  MethodSection,
  Note,
  Pill,
  Row,
  SourceRef,
  Table,
  Term,
  Toc,
} from "@/components/engine/EnginePrimitives";
import { SCORING_WEIGHTS } from "@/lib/engine/objective";
import {
  CR_FLOOR,
  CR_UNRECOVERABLE,
  MIN_LEAD_DAYS,
  RAMP_ALLOWANCE,
} from "@/lib/engine/priority-score";
import { COMPLEXITY_TIERS } from "@/lib/engine/complexity";
import {
  CHANGEOVER_BASE_MINUTES,
  COLOUR_CHANGE_MINUTES,
  COLOUR_LIGHTNESS,
  COMPLEXITY_SPREAD_MINUTES,
  FABRIC_CHANGE_MINUTES,
  LIGHT_AFTER_DARK_MINUTES,
  STAGE_CHANGEOVER_WEIGHT,
  THREAD_CHANGE_MINUTES,
} from "@/lib/engine/changeover";
import { RETENTION_DECAY_DAYS } from "@/lib/engine/capacity";
import { RM_BUFFER_DAYS } from "@/lib/engine/material-gate";
import {
  MERGE_WINDOW_DAYS,
  SUB_SCALE_RAMP_SHARE,
  VIABILITY_EFFICIENCY_THRESHOLD,
} from "@/lib/engine/run-size";
import { ASSIGNMENT_STRATEGIES } from "@/lib/engine/assignment";
import { SEQUENCE_STRATEGIES } from "@/lib/engine/optimizer";
import {
  AT_RISK_WINDOW_DAYS,
  REPLAN_HORIZON_DAYS,
  SEQUENCE_HORIZON_DAYS,
} from "@/lib/engine/sequencing-policy";
import { PACKING_DRAG, ROUTE_TEMPLATES, STAGE_LABELS, STAGE_ORDER } from "@/lib/types";

const TOC_ITEMS = [
  { id: "overview", label: "What this document is" },
  { id: "urgency", label: "Urgency & priority scoring" },
  { id: "capacity", label: "Capacity & learning curves" },
  { id: "changeover", label: "Changeover cost model" },
  { id: "material", label: "Material readiness gating" },
  { id: "pack-ratio", label: "Pack ratio, size mix & WIP" },
  { id: "run-size", label: "Run-size viability" },
  { id: "objective", label: "The objective function" },
  { id: "optimizer", label: "The optimizer & search" },
  { id: "routing", label: "Routing & per-line rates" },
  { id: "analytics", label: "Critical path, cut-off & material dates" },
  { id: "reference", label: "Parameter reference (appendix)" },
  { id: "scope", label: "What this deliberately does not model" },
];

export default function MethodologyPage() {
  return (
    <div className="flex flex-col gap-6 p-8">
      <header>
        <Link
          href="/engine"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-accent-hover"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Planning Rules & Parameters
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            Engine Methodology
          </h1>
          <Pill label="For SME & engineering review" tone="accent" />
        </div>
        <p className="mt-1.5 max-w-3xl text-muted">
          This is the algorithmic specification behind Auto-Sequence and Auto
          Plan: every formula, constant, and search procedure the scheduling
          engine runs, in one place. Planning Rules explains what today&apos;s
          plan did with today&apos;s orders; this page explains the mechanism
          itself — the thing that stays true regardless of which orders are
          loaded — so it can be reviewed, questioned, and improved on its own
          terms.
        </p>
      </header>

      <Toc items={TOC_ITEMS} />

      <MethodSection
        id="overview"
        number="0"
        title="What this document is, and the one idea underneath it"
      >
        <p className="text-sm leading-relaxed text-muted">
          The engine is a deterministic simulator (
          <span className="font-mono text-foreground">buildSchedule</span>)
          paired with a single scoring function (
          <span className="font-mono text-foreground">scorePlan</span>) that
          says how good the simulator&apos;s output is. Everything documented
          below is either an input to the simulator (how fast a line runs,
          when material gates a start, what a changeover costs) or a
          consequence of the score (which sequence and line assignment win).
          There is no separate &quot;AI model&quot; making these decisions —
          the intelligence is in the shape of the simulation and the search
          that calls it repeatedly.
        </p>
        <Note label="The distinctive part">
          The same pair — one simulator, one score — is reused, unmodified,
          in four different places: ranking candidate plans inside the
          optimizer&apos;s search (§8), pricing a what-if scenario for the AI
          recovery co-pilot, bounding the cut-off warning&apos;s binary
          search (§11), and grading the plan shown on the Planning Rules
          page. There is exactly one definition of &quot;a good plan&quot; in
          the system. Every feature that touches sequencing consumes it
          rather than embedding its own notion of quality, which is what lets
          a planner trust that tightening one slider has one consistent
          effect everywhere, and what would let a patent claim describe a
          single evaluator rather than four disconnected heuristics.
        </Note>
        <p className="text-sm leading-relaxed text-muted">
          Three conventions hold throughout this document:{" "}
          <strong className="text-foreground">lower priority number is more urgent</strong>{" "}
          (priority 1 outranks priority 90);{" "}
          <strong className="text-foreground">lower objective score is better</strong>{" "}
          (the optimizer minimises); and every named constant below is a real
          exported value in the codebase, not a rounded illustration — the{" "}
          <span className="font-mono text-foreground">SourceRef</span> line
          under each formula names the file and function it lives in.
        </p>
      </MethodSection>

      <MethodSection
        id="urgency"
        number="1"
        title="Urgency & priority scoring"
        subtitle="Which order genuinely needs a line next — not by delivery date alone, but by how much work stands between now and that date."
      >
        <Step label="Step 1 — remaining lead time">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Before urgency can be judged, the engine estimates how many
            calendar days of work an order still has left, assuming it had
            every line in every remaining stage entirely to itself.
          </p>
          <Formula>{`remainingLeadDays = Σ_stage∈route (order.quantity / piecesPerMinute(stage)) / shiftMinutes(stage)
                    × (1 + rampPenalty)

piecesPerMinute(stage) = Σ_line∈stage (operators × efficiencyBaseline) / (smv × packingDrag)
rampPenalty            = ${RAMP_ALLOWANCE} × (1 − curve.start) × 2`}</Formula>
          <div className="mt-3">
            <Glossary>
              <Term symbol="route">
                the ordered stages this order&apos;s style actually visits (§9)
              </Term>
              <Term symbol="piecesPerMinute(stage)">
                summed per line, not averaged — a line-specific SMV override
                means lines in the same stage no longer share one rate
              </Term>
              <Term symbol="packingDrag">
                1.0 for a solid pack, {PACKING_DRAG.assorted} for an assorted
                pack — an assorted carton takes longer to close at packing
              </Term>
              <Term symbol="rampPenalty">
                inflates the estimate for a complex style, whose line spends
                longer below target speed than the flat SMV maths implies
                (§2); {`curve.start`} is that style&apos;s day-one efficiency
              </Term>
            </Glossary>
          </div>
          <SourceRef
            path="src/lib/engine/priority-score.ts"
            functions={["estimateRemainingLeadTime"]}
          />
        </Step>

        <Step label="Step 2 — Critical Ratio">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Critical Ratio (CR) is a standard single-machine dispatching
            statistic — time remaining over work remaining — adapted here for
            a multi-stage flow shop with two guard rails, because used naively
            it misbehaves in both directions.
          </p>
          <Formula>{`CR = daysUntilDue / max(remainingLeadDays, ${MIN_LEAD_DAYS})`}</Formula>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <WorkedNumber label="CR above 1.0" value="Comfortable" tone="good" />
            <WorkedNumber label={`CR below 1.0, at/above ${CR_UNRECOVERABLE}`} value="Critical — jump the queue" tone="warn" />
            <WorkedNumber label={`CR below ${CR_UNRECOVERABLE}`} value="Unrecoverable — flagged, not chased" tone="bad" />
          </div>
          <Note tone="warn" label="Why CR needs guard rails">
            Once an order is past due, its numerator goes negative, and
            sorting by raw CR would put the single most hopeless order first
            — starving every order that could still be saved. Orders below
            the unrecoverable threshold are therefore moved out of the
            sequencing race entirely and surfaced for a delivery-date
            conversation instead. Separately, CR explodes as remaining lead
            time approaches zero, so the denominator is floored at{" "}
            {MIN_LEAD_DAYS} days to stop the score from swinging violently on
            an order&apos;s last day of work.
          </Note>
          <SourceRef
            path="src/lib/engine/priority-score.ts"
            functions={["scoreOrderPriority"]}
          />
        </Step>

        <Step label="Step 3 — blended priority score">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            CR alone is one input, not the sort key. It is blended with the
            planner&apos;s own priority flag and a hard penalty for material
            that has not arrived, into the number that actually orders the
            queue.
          </p>
          <Formula>{`urgency      = 1 / max(CR, ${CR_FLOOR})
plannerBoost = (100 − min(100, order.priority)) / 100

score = 1.0 × urgency + 0.6 × plannerBoost − (rmReady ? 0 : 2.0)`}</Formula>
          <div className="mt-3">
            <Glossary>
              <Term symbol="urgency">
                CR inverted and floored at {CR_FLOOR}, so no single desperate
                order can push its score toward infinity and dominate every
                other term
              </Term>
              <Term symbol="plannerBoost">
                priority 1 (most important) contributes {"0.99"}; priority
                100 (least) contributes {"0"} — a direct, bounded lever for a
                planner&apos;s own call
              </Term>
              <Term symbol="rmReady">
                whether the order&apos;s material gate (§4) has already
                passed — an order that is not ready loses 2.0 points
                regardless of how urgent it looks, since starting it early is
                not possible
              </Term>
            </Glossary>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Sequencing then sorts unrecoverable orders to the bottom first,
            highest score next, and falls back to the order&apos;s original
            position to keep ties deterministic.
          </p>
          <SourceRef
            path="src/lib/engine/priority-score.ts"
            functions={["sequenceByPriority", "scoreAllPriorities"]}
          />
        </Step>

        <Step label="An alternative view: slack per operation">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            The optimizer (§8) does not commit to one ranking rule — it also
            tries this one, and keeps whichever produces the better-scoring
            plan. It normalises slack by how many stages are actually ahead
            of the order, which behaves better than raw CR once orders are
            queued behind each other rather than running alone.
          </p>
          <Formula>{`slackPerOperation = (daysUntilDue − remainingLeadDays) / operationsRemaining`}</Formula>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Sorted ascending — least slack per remaining operation first —
            with planner priority breaking ties.
          </p>
          <SourceRef
            path="src/lib/engine/priority-score.ts"
            functions={["sequenceBySlackPerOperation"]}
          />
        </Step>
      </MethodSection>

      <MethodSection
        id="capacity"
        number="2"
        title="Capacity & learning curves"
        subtitle="How many pieces a line makes in a day, and why that number climbs over the first days of a new style rather than starting at full speed."
      >
        <Step label="Daily line capacity">
          <Formula>{`dailyCapacity = floor( (operators × shiftMinutes × efficiency) / (smv × packingDrag) )

efficiency = line.efficiencyBaseline × learningEfficiency(styleId, lineId, dayOnStyle)`}</Formula>
          <div className="mt-3">
            <Glossary>
              <Term symbol="smv">
                standard minutes per unit for this style at this stage — line
                overrides (§9) checked first, then the style-wide rate
              </Term>
              <Term symbol="efficiencyBaseline">
                the line&apos;s own long-run efficiency, independent of how
                new the style is
              </Term>
              <Term symbol="learningEfficiency">
                0..1, from the learning curve below — this is the term that
                actually moves day to day
              </Term>
            </Glossary>
          </div>
          <SourceRef
            path="src/lib/engine/capacity.ts"
            functions={["dailyLineCapacity", "estimateLineMinutes"]}
          />
        </Step>

        <Step label="The learning curve — an exponential ramp, not a lookup table">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            A harder garment does not cost more minutes per piece at steady
            state — SMV already prices that in. What complexity actually
            determines is how long a line takes to <em>reach</em> steady
            state. The curve is exponential and two-parameter rather than a
            hand-typed table, because two parameters can be fitted from
            production history (see the next step); seven typed-in points can
            only be guessed at, and go stale.
          </p>
          <Formula>{`efficiency(day) = start                                     , day = 1
efficiency(day) = start + (target − start) × (1 − e^(−(day−1)/τ))  , day > 1`}</Formula>
          <div className="mt-3">
            <Table
              columns={[
                { label: "Tier" },
                { label: "Complexity range" },
                { label: "Day-1 start", align: "right" },
                { label: "Target", align: "right" },
                { label: "τ (days)", align: "right" },
              ]}
            >
              {Object.entries(COMPLEXITY_TIERS).map(
                ([tier, def], i, arr) => (
                  <Row key={tier}>
                    <Cell strong>{tier} — {def.label}</Cell>
                    <Cell tone="muted">
                      {i === 0
                        ? `below ${def.maxComplexity}`
                        : Number.isFinite(def.maxComplexity)
                          ? `${arr[i - 1]![1].maxComplexity}–${def.maxComplexity}`
                          : `above ${arr[i - 1]![1].maxComplexity}`}
                    </Cell>
                    <Cell align="right">{def.curve.start}</Cell>
                    <Cell align="right">{def.curve.target}</Cell>
                    <Cell align="right">{def.curve.tau}</Cell>
                  </Row>
                )
              )}
            </Table>
          </div>
          <Note>
            Parameters are tuned so this parametric curve tracks the
            previously hand-authored seed curves, so turning it on does not
            swing existing plans wildly — it replaces a guess with a formula
            that produces roughly the same guess, then improves from there as
            real data arrives.
          </Note>
          <SourceRef
            path="src/lib/engine/complexity.ts"
            functions={["efficiencyAtDay", "curveParamsForComplexity", "tierForComplexity"]}
          />
        </Step>

        <Step label="Learning that learns: fitting curves from recorded output">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Every time a planner records an actual quantity against a
            planned one, that is a real data point about how a specific
            style ran on a specific line. This turns those points into a
            curve that improves on the complexity-tier prior — without
            letting one noisy day overwrite a model built on nothing.
          </p>
          <Formula>{`ratio(day)  = clamp(actualQty / plannedQty, 0.5, 1.5)          // one day, clamped
bias        = mean(ratio(day) for all recorded days)
shrinkage   = n / (n + 5)                                       // n = days observed
blendedBias = 1 + shrinkage × (bias − 1)

fittedCurve(day) = clamp(priorCurve(day) × blendedBias, 0, 1)`}</Formula>
          <div className="mt-3">
            <Glossary>
              <Term symbol="shrinkage">
                rises from 0 toward 1 as observations accumulate — 1 day of
                data nudges the curve by {"1/6"} of the way toward what was
                observed, 5 days by half, 20 days by {"4/5"} — so a handful
                of points bend the prior rather than replace it outright
              </Term>
              <Term symbol="priorCurve">
                the complexity-tier curve above, or an authored curve if one
                exists — deliberately not the fit being built here, so a fit
                never feeds on itself
              </Term>
            </Glossary>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Fits are kept at style×line granularity — the same key the
            per-line rate overrides use (§9) — and when more than one stage
            has recorded actuals for the same style×line, the fit with the
            most observations wins, since the curve itself carries no memory
            of which stage produced it.
          </p>
          <SourceRef
            path="src/lib/engine/learning-fit.ts"
            functions={["fitObservedCurves", "mergeFittedCurves"]}
          />
        </Step>

        <Step label="Learning retention: what a line remembers">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            A line returning to a style it ran recently should not start cold
            — but the advantage fades the longer the line has been away from
            it.
          </p>
          <Formula>{`retainedDays = floor( priorDaysOnStyle × e^(−idleDays / ${RETENTION_DECAY_DAYS}) )`}</Formula>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            The line resumes the curve at{" "}
            <span className="font-mono text-foreground">retainedDays</span>{" "}
            rather than day 1. At {RETENTION_DECAY_DAYS} idle days, exactly
            half the prior learning survives; by {RETENTION_DECAY_DAYS * 3} it
            is under 5%.
          </p>
          <SourceRef
            path="src/lib/engine/capacity.ts"
            functions={["retainedDaysOnStyle"]}
          />
        </Step>
      </MethodSection>

      <MethodSection
        id="changeover"
        number="3"
        title="Changeover cost model"
        subtitle="What it costs a line to stop making one thing and start another — in style, and independently in colour."
      >
        <Step label="Style changeover">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Measured historical changeover time per line is the ideal input,
            but no factory has it cleanly on day one. This derives a
            defensible estimate from attributes already on file — how far
            apart two styles are in complexity, and whether the fabric
            itself changes — designed to be swapped for measured data the
            moment it exists, without touching anything downstream.
          </p>
          <Formula>{`raw   = ${CHANGEOVER_BASE_MINUTES} + |Δcomplexity| × ${COMPLEXITY_SPREAD_MINUTES} + (fabricChanged ? ${FABRIC_CHANGE_MINUTES} : 0)
cost  = round(raw × stageWeight[stage])`}</Formula>
          <div className="mt-3">
            <Table columns={[{ label: "Stage" }, { label: "Weight", align: "right" }]}>
              {STAGE_ORDER.map((stage) => (
                <Row key={stage}>
                  <Cell>{STAGE_LABELS[stage]}</Cell>
                  <Cell align="right">{STAGE_CHANGEOVER_WEIGHT[stage]}</Cell>
                </Row>
              ))}
            </Table>
          </div>
          <Note>
            Sewing is the reference point at full weight — it is the hardest
            stage to re-set. Knitting and cutting are cheaper to retool;
            packing and dispatch are nearly free, since they mostly re-set by
            swapping a carton spec.
          </Note>
          <SourceRef
            path="src/lib/engine/changeover.ts"
            functions={["changeoverMinutes"]}
          />
        </Step>

        <Step label="Colour & thread changeover — deliberately asymmetric">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            A line threaded for one colour pays a real rethread cost to
            switch, and that cost is not the same in both directions.
            Running a light shade after a dark one needs a full cleardown or
            it contaminates the batch; going the other way is close to free.
            A symmetric distance metric would price these the same and let
            the optimizer sequence dark-to-light as cheaply as light-to-dark
            — the opposite of how a dyehouse actually plans a run.
          </p>
          <Formula>{`bodyChanged   = from.colour ≠ to.colour
threadChanged = (from.thread ?? from.colour) ≠ (to.thread ?? to.colour)

raw  = bodyChanged ? ${COLOUR_CHANGE_MINUTES} : 0
raw += bodyChanged && lift(to) > lift(from) ? (lift(to) − lift(from)) × ${LIGHT_AFTER_DARK_MINUTES} : 0
raw += threadChanged ? ${THREAD_CHANGE_MINUTES} : 0

cost = round(raw × stageWeight[stage])`}</Formula>
          <div className="mt-3">
            <Table columns={[{ label: "Colour" }, { label: "Lightness (0 = darkest, 1 = lightest)", align: "right" }]}>
              {Object.entries(COLOUR_LIGHTNESS).map(([colour, lightness]) => (
                <Row key={colour}>
                  <Cell className="capitalize">{colour}</Cell>
                  <Cell align="right">{lightness}</Cell>
                </Row>
              ))}
            </Table>
          </div>
          <Note tone="warn">
            The lightness scale is a lookup table, not a colour-science
            model — a stand-in until a factory supplies its own shade
            groupings. Unknown colours are scored at 0.5 (mid-scale) so an
            unrecognised name never fabricates a cleardown penalty in either
            direction.
          </Note>
          <SourceRef
            path="src/lib/engine/changeover.ts"
            functions={["colourChangeMinutes"]}
          />
        </Step>
      </MethodSection>

      <MethodSection
        id="material"
        number="4"
        title="Material readiness gating"
        subtitle="An order cannot start before its material does — and multiple materials mean the latest one, not the first, decides the date."
      >
        <Formula>{`effectiveRmDate = max(material.inHouseDate for every listed material) + ${RM_BUFFER_DAYS} day(s)
rmReady(today)  = effectiveRmDate ≤ today`}</Formula>
        <div className="mt-3">
          <Glossary>
            <Term symbol="max(...)">
              an order is blocked on its slowest-arriving material — fabric,
              trim, and labels arrive separately, and all of them have to be
              on the floor before cutting or knitting can start
            </Term>
            <Term symbol={`+ ${RM_BUFFER_DAYS} day(s)`}>
              covers inspection, shrinkage testing, and physically issuing
              the material to the floor — starting the instant material
              lands is not physically realistic
            </Term>
          </Glossary>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Orders carrying the newer per-material breakdown are gated on the
          latest of that list; orders that only carry the legacy single date
          fall back to it directly, so nothing already in the system needed
          to be re-entered for this to apply.
        </p>
        <SourceRef
          path="src/lib/engine/material-gate.ts"
          functions={["effectiveRmDate", "blockingMaterial"]}
        />
      </MethodSection>

      <MethodSection
        id="pack-ratio"
        number="5"
        title="Pack ratio, size mix & work-in-progress"
        subtitle="Stitching 100 smalls before touching a single medium or large doesn't ship anything — it strands stock on the floor until the last size starts. This is the model that makes that visible and costable."
      >
        <Step label="How sizes are drawn down">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Each cell of output has to decide which sizes make it up. This is
            a decision variable the engine can be scored on, not a constant —{" "}
            <span className="font-mono text-foreground">sizeBlocked</span>{" "}
            runs one size to exhaustion before starting the next (the
            behaviour a size-blind schedule defaults to);{" "}
            <span className="font-mono text-foreground">ratio</span> draws
            every open size in proportion to the carton, so cartons close
            continuously instead of only at the very end.
          </p>
          <Formula>{`weight(size) = packRatio.sizes[size]     // assorted carton — the carton's own ratio
weight(size) = remaining[size]           // solid carton — no cross-size ratio to honour

take(size) = floor(qty × weight(size) / Σweight)      then largest-remainder
             rounds the leftover units out, capped at what remains of that size`}</Formula>
          <SourceRef
            path="src/lib/engine/pack-ratio.ts"
            functions={["takeSizeMix", "scaleToTotal"]}
          />
        </Step>

        <Step label="What can actually ship">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Units produced are not units shippable. A carton needs its full
            ratio of sizes (assorted) or a full multiple of its unit count
            (solid) before it closes.
          </p>
          <Formula>{`// solid pack — each size closes its own cartons independently
shippable = Σ_size  floor(produced[size] / unitsPerCarton) × unitsPerCarton

// assorted pack — bounded by the scarcest size relative to its ratio
shippable = min_size( floor(produced[size] / ratio[size]) ) × unitsPerCarton

stranded  = produced − shippable`}</Formula>
          <SourceRef
            path="src/lib/engine/pack-ratio.ts"
            functions={["shippableUnits", "strandedUnits"]}
          />
        </Step>

        <Step label="WIP, expressed in unit-days">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Stranded units sitting on the floor for a week are a bigger
            problem than the same units stranded for a day, so WIP is
            measured in unit-days, not a point-in-time snapshot. It is
            measured at sewing, since that is the operation that feeds
            packing and therefore decides whether a carton can close, and it
            is measured per colour — a Navy carton cannot be closed with
            White pieces, so pooling sizes across colourways would report
            stock as shippable that the floor could not actually pack.
          </p>
          <Formula>{`wipUnitDays = Σ_order Σ_colour Σ_day<lastDay  stranded(cumulativeOutput[colour], day)`}</Formula>
          <Note>
            The order&apos;s final production day is excluded deliberately —
            stock stranded on the day the order finishes is the order
            completing, not WIP being carried forward.
          </Note>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This single measure does double duty: it is both the pack-ratio
            sequencing signal (does this plan strand stock?) and the
            WIP term in the objective function (§7) — deliberately
            expressed in the same shape as a &quot;WIP days on floor&quot;
            baseline a factory would already track.
          </p>
          <SourceRef
            path="src/lib/engine/pack-ratio.ts"
            functions={["wipUnitDays"]}
          />
        </Step>
      </MethodSection>

      <MethodSection
        id="run-size"
        number="6"
        title="Run-size viability"
        subtitle="A learning curve only pays for itself over a long enough run. This flags orders too small to amortise it."
      >
        <Formula>{`walk day = 1, 2, 3, ... on the stage's fastest line, accumulating dailyCapacity,
until efficiency(day) ≥ ${VIABILITY_EFFICIENCY_THRESHOLD}   → unitsToReachThreshold

rampShare = min(1, unitsToReachThreshold / order.quantity)
subScale  = rampShare ≥ ${SUB_SCALE_RAMP_SHARE}`}</Formula>
        <div className="mt-3">
          <Glossary>
            <Term symbol="fastest line">
              the line with the highest operators × efficiencyBaseline in the
              stage — the optimistic case; if even the best line cannot get
              this order up to speed, no line can
            </Term>
            <Term symbol="rampShare">
              the share of the order that would be made before the line is
              considered up to speed at all
            </Term>
          </Glossary>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          A flagged order is also checked against every other order of the
          same style due within {MERGE_WINDOW_DAYS} days, as a merge
          candidate — combining two sub-scale runs into one amortises the
          ramp instead of paying for it twice.
        </p>
        <SourceRef
          path="src/lib/engine/run-size.ts"
          functions={["assessRunSizes", "unitsBeforeThreshold"]}
        />
      </MethodSection>

      <MethodSection
        id="objective"
        number="7"
        title="The objective function"
        subtitle="Every candidate plan is reduced to one number. The plan with the lowest score wins. This is what lets the engine trade one problem for another instead of optimising a single metric blindly."
      >
        <Formula>{`score =  w.tardiness  × Σ(daysLate × tardinessWeight(priority))     // over late orders only
      +  w.unfinished × count(orders that never finish in horizon)
      +  w.changeover × changeoverHours
      +  w.idle       × idleLineHours
      +  w.churn      × count(orders whose sequence position moved vs. published)
      +  w.wip        × wipUnitDays
      −  w.throughput × unitsShippedInHorizon

tardinessWeight(priority) = max(0.5, 2 − priority / 40)`}</Formula>
        <div className="mt-3">
          <Table
            columns={[
              { label: "Weight" },
              { label: "Default", align: "right" },
              { label: "Charged per" },
            ]}
          >
            <Row>
              <Cell strong>tardiness</Cell>
              <Cell align="right">{SCORING_WEIGHTS.tardiness}</Cell>
              <Cell tone="muted">weighted day an order finishes past its deadline</Cell>
            </Row>
            <Row>
              <Cell strong>unfinished</Cell>
              <Cell align="right">{SCORING_WEIGHTS.unfinished}</Cell>
              <Cell tone="muted">order that does not finish inside the horizon at all</Cell>
            </Row>
            <Row>
              <Cell strong>changeover</Cell>
              <Cell align="right">{SCORING_WEIGHTS.changeover}</Cell>
              <Cell tone="muted">hour lost to style or colour changeovers</Cell>
            </Row>
            <Row>
              <Cell strong>idle</Cell>
              <Cell align="right">{SCORING_WEIGHTS.idle}</Cell>
              <Cell tone="muted">idle line-hour inside the makespan</Cell>
            </Row>
            <Row>
              <Cell strong>churn</Cell>
              <Cell align="right">{SCORING_WEIGHTS.churn}</Cell>
              <Cell tone="muted">order whose position moved against the published plan</Cell>
            </Row>
            <Row>
              <Cell strong>wip</Cell>
              <Cell align="right">{SCORING_WEIGHTS.wip}</Cell>
              <Cell tone="muted">unit-day of stitched stock that cannot close a carton</Cell>
            </Row>
            <Row>
              <Cell strong>throughput</Cell>
              <Cell align="right">{SCORING_WEIGHTS.throughput}</Cell>
              <Cell tone="muted">unit shipped inside the horizon (credited, not charged)</Cell>
            </Row>
          </Table>
        </div>
        <Note>
          These are planner-tunable on the Planning parameters panel above
          (§ Planning Rules), not fixed in code. Moving a slider changes
          this formula&apos;s inputs, which changes which candidate plan the
          optimizer picks — the same lever the whole engine ultimately turns
          on.
        </Note>
        <Note tone="warn" label="Why priority weights tardiness, not just counts it">
          A late order matters more when the planner flagged it as important.{" "}
          <span className="font-mono text-foreground">tardinessWeight</span>{" "}
          scales from {"0.5"} (priority 100, least important) up toward{" "}
          {"2.0"} (priority 0, most important), so missing a priority
          customer&apos;s date costs up to four times what missing a filler
          order&apos;s date does, for the same number of days late.
        </Note>
        <SourceRef
          path="src/lib/engine/objective.ts"
          functions={["scorePlan", "tardinessWeight", "computeIdleHours", "computeChurn"]}
        />
      </MethodSection>

      <MethodSection
        id="optimizer"
        number="8"
        title="The optimizer & search procedure"
        subtitle="buildSchedule is deterministic and fast, which makes it a usable evaluator, not just a plan generator. So instead of trusting one dispatch rule, the engine proposes a spread of candidate plans, simulates every one, and hill-climbs from the winner."
      >
        <Step label="Candidate generation">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            {SEQUENCE_STRATEGIES.length} sequencing heuristics ×{" "}
            {ASSIGNMENT_STRATEGIES.length} line-assignment strategies ={" "}
            {SEQUENCE_STRATEGIES.length * ASSIGNMENT_STRATEGIES.length} base
            candidates, each fully simulated through{" "}
            <span className="font-mono text-foreground">buildSchedule</span>{" "}
            and scored through{" "}
            <span className="font-mono text-foreground">scorePlan</span>.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border-subtle bg-surface-elevated px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Sequencing heuristics
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                <li><span className="text-foreground">deadline</span> — earliest delivery date first (the naive baseline)</li>
                <li><span className="text-foreground">criticalRatio</span> — blended priority score (§1)</li>
                <li><span className="text-foreground">slackPerOperation</span> — slack normalised by stages remaining (§1)</li>
                <li><span className="text-foreground">changeoverMinimizing</span> — same-style orders clustered, clusters ranked by their most urgent member</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface-elevated px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Assignment strategies
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                <li><span className="text-foreground">spreadAll</span> — every order occupies every line in a stage (historical default)</li>
                <li><span className="text-foreground">dedicate</span> — pins an order to one line, weighting changeover avoidance at 8×</li>
                <li><span className="text-foreground">balanced</span> — pins an order to one line, mostly chasing the earliest-free line (1× weight)</li>
              </ul>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            The deadline × spreadAll candidate is always kept as the{" "}
            <span className="font-mono text-foreground">baseline</span>, so a
            planner can see exactly how many points the optimizer bought over
            the naive plan.
          </p>
          <SourceRef
            path="src/lib/engine/optimizer.ts"
            functions={["optimizeSchedule", "buildSequenceCandidates"]}
          />
        </Step>

        <Step label="Line-pick cost, inside dedicate and balanced">
          <Formula>{`cost(line)  = workMinutes(order, line) + changeoverMinutes(line.lastStyle, order.style)
score(line) = runningLoad[line] + workMinutes + changeoverMinutes × setupWeight(strategy)

pick the line with the lowest score(line); setupWeight = 8 for dedicate, 1 for balanced`}</Formula>
          <SourceRef path="src/lib/engine/assignment.ts" functions={["buildAssignments", "pickLine"]} />
        </Step>

        <Step label="Local search: adjacent-swap hill-climbing">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            The cheapest base candidate is refined further by trying every
            adjacent pair-swap in its sequence, keeping any swap that lowers
            the score, and repeating passes until a full pass produces no
            improvement (or a pass limit is hit).
          </p>
          <Formula>{`for pass in 1..maxPasses:
  improved = false
  for i in 0..len(sequence)-2:
    trial = swap(sequence, i, i+1)
    if score(trial) < score(current):
      current = trial; improved = true
  if not improved: break   // local optimum reached`}</Formula>
          <Note>
            Deliberately a small neighbourhood: the sequence is order-count
            sized, every evaluation is a full simulation (not an
            approximation), and a plan that stays close to something
            explainable is worth more to a planner than a marginally cheaper
            plan that reshuffles everything. Twelve passes is the default
            ceiling.
          </Note>
          <SourceRef path="src/lib/engine/optimizer.ts" functions={["hillClimb"]} />
        </Step>

        <Note label="On determinism">
          Nothing in this search is randomised. The same orders, styles,
          lines, weights, and physics flags always produce the same plan —
          which is what makes the plan explainable (every number on Planning
          Rules is reproducible) and what makes the parity harness (
          <span className="font-mono text-foreground">scripts/verify-parity.ts</span>
          ) a meaningful regression check rather than a flaky one.
        </Note>
      </MethodSection>

      <MethodSection
        id="routing"
        number="9"
        title="Routing & per-line rates"
        subtitle="Not every style visits every stage, and not every line runs a style at the same rate. Both are data, not code paths."
      >
        <Step label="Route templates">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            A style names a route; the route names the stages it visits, in
            order. A factory that buys finished, dyed fabric skips knitting
            entirely rather than running it as a zero-cost no-op — the
            operation is absent from the route, not free inside it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.values(ROUTE_TEMPLATES).map((route) => (
              <div
                key={route.id}
                className="rounded-lg border border-border-subtle bg-surface-elevated px-4 py-3"
              >
                <p className="text-sm font-medium text-foreground">{route.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {route.operations.map((s) => STAGE_LABELS[s]).join(" → ")}
                </p>
              </div>
            ))}
          </div>
          <SourceRef path="src/lib/types.ts" functions={["stagesForRoute", "smvFor"]} />
        </Step>

        <Step label="Per-line SMV & learning-curve overrides">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Most lines run a style at its standard rate. A sparse override
            map lets specific lines differ — a newer machine, an older one —
            without forcing every line to carry its own copy of every
            style&apos;s data.
          </p>
          <Formula>{`smv(style, stage, lineId)   = style.lineSmv?.[lineId]?.[stage]        ?? style.smv[stage]
curve(style, stage, lineId) = learningCurves[\`\${styleId}:\${lineId}\`]   ?? learningCurves[styleId]`}</Formula>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Absent is not zero — it means &quot;inherit the style-wide
            rate&quot;. This is what let a 24-line scale test add overrides
            for specific lines without touching the golden-baseline parity
            fixture.
          </p>
          <SourceRef path="src/lib/types.ts" functions={["smvFor"]} />
        </Step>
      </MethodSection>

      <MethodSection
        id="analytics"
        number="10"
        title="Critical path, cut-off warning & suggested material dates"
        subtitle="Three things the plan doesn't say out loud, computed by reading the same plan the rules above already built — none of them change what gets scheduled."
      >
        <Step label="Critical path — where slack actually disappears">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Every route here runs strictly in sequence — never two stages
            racing in parallel — so the classic compare-competing-paths
            question does not apply. What still varies is slack: whether a
            stage started the moment it possibly could, or sat queued behind
            a busy line.
          </p>
          <Formula>{`earliestPossibleStart(stage) = predecessor.completion + 1 day     // or the RM gate, for stage 1
queueDelayDays(stage)        = max(0, actualStart − earliestPossibleStart)
onCriticalPath(stage)        = queueDelayDays == 0

criticalChain = walk stages backward from completion,
                stop at (and include) the first stage with queueDelayDays > 0`}</Formula>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            A stage with zero slack is genuinely gating the finish date;
            speeding it up would pull the order in. A stage with slack could
            run later without moving anything, because something after it
            already determines when the order finishes.
          </p>
          <SourceRef path="src/lib/engine/critical-path.ts" functions={["computeCriticalPaths"]} />
        </Step>

        <Step label="Cut-off warning — the same what-if, binary-searched">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            The engine already answers &quot;what happens if this
            order&apos;s material slips N days&quot; through the what-if
            scenario path used by AI recovery. The cut-off warning just asks
            that question at increasing N and binary-searches for the
            boundary, instead of a planner guessing at N.
          </p>
          <Formula>{`isAbsorbable(N) = (order's completion date under a shift-RM-date(N) scenario) ≤ order.deliveryDeadline

binary-search over N ∈ [0, 30] for the largest N where isAbsorbable(N) holds
  → maxAbsorbableDays, cutoffDate = order.rmInHouseDate + maxAbsorbableDays`}</Formula>
          <Note tone="warn">
            Feasibility is assumed monotonic — more delay never makes things
            easier — which the objective&apos;s structure guarantees in
            practice, though nothing enforces it as a hard invariant. The
            bar for &quot;absorbable&quot; is deliberately the order&apos;s{" "}
            <em>own</em> deadline, not the plan&apos;s aggregate late-order
            count — checking the aggregate would under-warn on a plan that
            already has late orders elsewhere, since one more day on an
            already-late order doesn&apos;t change that count.
          </Note>
          <SourceRef path="src/lib/engine/cutoff.ts" functions={["findRmCutoff"]} />
        </Step>

        <Step label="Suggested material in-house dates — a backward pass">
          <p className="mb-3 text-sm leading-relaxed text-muted">
            Every other part of this engine takes material arrival as a
            given input and schedules forward from it. This runs the same
            capacity model backward from the delivery deadline, independent
            of the {SEQUENCE_HORIZON_DAYS}-day planning horizon on purpose —
            it answers &quot;when do I need to place the yarn order for
            panels I won&apos;t knit for months&quot;, long before that
            order would ever appear in a forward-scheduled plan.
          </p>
          <Formula>{`desiredStageOneStart   = order.deliveryDeadline − ceil(remainingLeadDays)      // §1's own formula, run backward
suggestedInHouseDate   = desiredStageOneStart − ${RM_BUFFER_DAYS} day(s)
isLate(material)       = material.currentInHouseDate > suggestedInHouseDate`}</Formula>
          <Note>
            Every listed material on an order gets the same suggested date
            today, because materials are not yet tied to which stage
            consumes them — every material collectively gates the same first
            stage. Staggering the suggestion by consuming stage is a known
            gap, listed in §12.
          </Note>
          <SourceRef path="src/lib/engine/material-suggestion.ts" functions={["suggestMaterialDates"]} />
        </Step>
      </MethodSection>

      <MethodSection
        id="reference"
        number="11"
        title="Parameter reference"
        subtitle="Every named constant in the engine that isn't already planner-tunable on the parameters panel — what it means, and where it lives, so a reviewer can trace every claim above back to code."
      >
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-elevated text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Constant</th>
                <th className="px-4 py-2.5 font-medium text-right">Value</th>
                <th className="px-4 py-2.5 font-medium">Meaning</th>
                <th className="px-4 py-2.5 font-medium">File</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "MIN_LEAD_DAYS", value: MIN_LEAD_DAYS, meaning: "Floor on the CR denominator", file: "priority-score.ts" },
                { name: "CR_UNRECOVERABLE", value: CR_UNRECOVERABLE, meaning: "Below this CR, an order leaves the sequencing race", file: "priority-score.ts" },
                { name: "CR_FLOOR", value: CR_FLOOR, meaning: "Floor on urgency = 1/CR", file: "priority-score.ts" },
                { name: "RAMP_ALLOWANCE", value: RAMP_ALLOWANCE, meaning: "Inflates lead-time estimate for a fresh style's ramp", file: "priority-score.ts" },
                { name: "RM_BUFFER_DAYS", value: RM_BUFFER_DAYS, meaning: "Inspection & issue-to-floor buffer after material lands", file: "material-gate.ts" },
                { name: "RETENTION_DECAY_DAYS", value: RETENTION_DECAY_DAYS, meaning: "Half-life of retained learning when a line is idle on a style", file: "capacity.ts" },
                { name: "SHRINKAGE_K", value: 5, meaning: "Observations at which a fitted curve is weighted half prior, half observed", file: "learning-fit.ts" },
                { name: "MIN/MAX_DAY_RATIO", value: "0.5 / 1.5", meaning: "Clamp on one day's actual÷planned ratio before it enters a fit", file: "learning-fit.ts" },
                { name: "CHANGEOVER_BASE_MINUTES", value: CHANGEOVER_BASE_MINUTES, meaning: "Floor cost of any style changeover", file: "changeover.ts" },
                { name: "COMPLEXITY_SPREAD_MINUTES", value: COMPLEXITY_SPREAD_MINUTES, meaning: "Minutes per unit of complexity gap between two styles", file: "changeover.ts" },
                { name: "FABRIC_CHANGE_MINUTES", value: FABRIC_CHANGE_MINUTES, meaning: "Extra minutes when the fabric type itself changes", file: "changeover.ts" },
                { name: "COLOUR_CHANGE_MINUTES", value: COLOUR_CHANGE_MINUTES, meaning: "Floor cost of any colour changeover", file: "changeover.ts" },
                { name: "LIGHT_AFTER_DARK_MINUTES", value: LIGHT_AFTER_DARK_MINUTES, meaning: "Extra minutes for a full cleardown, scaled by the lightness jump", file: "changeover.ts" },
                { name: "THREAD_CHANGE_MINUTES", value: THREAD_CHANGE_MINUTES, meaning: "Extra minutes when only the thread shade changes", file: "changeover.ts" },
                { name: "VIABILITY_EFFICIENCY_THRESHOLD", value: VIABILITY_EFFICIENCY_THRESHOLD, meaning: "\"Up to speed\" line for run-size viability", file: "run-size.ts" },
                { name: "SUB_SCALE_RAMP_SHARE", value: SUB_SCALE_RAMP_SHARE, meaning: "Share of a run below threshold that flags it sub-scale", file: "run-size.ts" },
                { name: "MERGE_WINDOW_DAYS", value: MERGE_WINDOW_DAYS, meaning: "Deadline proximity for same-style merge candidates", file: "run-size.ts" },
                { name: "setupWeight (dedicate / balanced)", value: "8 / 1", meaning: "How heavily the assignment strategy avoids a changeover", file: "assignment.ts" },
                { name: "DEFAULT_LOCAL_SEARCH_PASSES", value: 12, meaning: "Hill-climb pass ceiling", file: "optimizer.ts" },
                { name: "AT_RISK_WINDOW_DAYS", value: AT_RISK_WINDOW_DAYS, meaning: "Completion within this many days of deadline reads as \"at risk\"", file: "sequencing-policy.ts" },
                { name: "SEQUENCE_HORIZON_DAYS", value: SEQUENCE_HORIZON_DAYS, meaning: "Horizon used when sequencing incoming ERP orders", file: "sequencing-policy.ts" },
                { name: "REPLAN_HORIZON_DAYS", value: REPLAN_HORIZON_DAYS, meaning: "Longer horizon used when replanning around locked actuals", file: "sequencing-policy.ts" },
                { name: "PACKING_DRAG (solid / assorted)", value: `${PACKING_DRAG.solid} / ${PACKING_DRAG.assorted}`, meaning: "Multiplier on packing SMV for an assorted vs. solid carton", file: "types.ts" },
                { name: "DEFAULT_MAX_DAYS (cut-off search)", value: 30, meaning: "Upper bound the cut-off binary search tests before giving up", file: "cutoff.ts" },
              ].map((row) => (
                <tr key={row.name} className="border-t border-border-subtle">
                  <td className="px-4 py-2.5 font-mono text-xs text-accent-hover">{row.name}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{row.value}</td>
                  <td className="px-4 py-2.5 text-muted">{row.meaning}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted/70">{row.file}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted/70">
          The seven scoring weights and eight engine-fidelity flags are
          documented on the Planning parameters panel itself (Planning
          Rules, above) rather than duplicated here, since those are already
          live and planner-tunable — this table covers everything that
          currently is not.
        </p>
      </MethodSection>

      <MethodSection
        id="scope"
        number="12"
        title="What this deliberately does not model yet"
        subtitle="Named here on purpose, so a reviewer can tell a gap that was considered and deferred from one nobody noticed."
      >
        <ul className="list-inside list-disc space-y-2 text-sm leading-relaxed text-muted">
          <li>
            Changeover time is estimated from style attributes, not measured
            per line from history — the signature (§3) is designed to accept
            measured data the moment a factory has it, without changing
            anything downstream.
          </li>
          <li>
            Every material on an order shares one suggested in-house date
            (§10) — staggering by which stage actually consumes each
            material is deferred until that link exists in the data model.
          </li>
          <li>
            Critical-path analysis (§10) only has slack to report because
            every route runs strictly in sequence — a factory with genuinely
            parallel sub-assembly paths would need the classic
            multiple-paths CPM comparison, which this does not implement.
          </li>
          <li>
            Planning parameters (the weights and physics flags) persist to
            the browser&apos;s local storage, not to a shared,
            per-organisation record — two planners on the same account do
            not yet see each other&apos;s tuning.
          </li>
          <li>
            Learning curves are fitted at style×line granularity, not
            style×operation×line — a style with recorded actuals on more
            than one stage yields one fit, taken from whichever stage has
            the most observations (§2).
          </li>
        </ul>
        <p className="mt-4 flex items-start gap-2 text-xs text-muted/70">
          <FileCode2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          A fuller build history and rationale for each phase of this engine
          lives in{" "}
          <span className="font-mono">KNIT-TO-PACK-ROADMAP.md</span> in the
          repository.
        </p>
      </MethodSection>
    </div>
  );
}

function WorkedNumber({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad";
}) {
  const toneClass = {
    good: "border-success/30 bg-success/5 text-success",
    warn: "border-warning/30 bg-warning/5 text-warning",
    bad: "border-danger/30 bg-danger/5 text-danger",
  }[tone];
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${toneClass}`}>
      <p className="text-[11px] font-medium opacity-80">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Step({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      {children}
    </div>
  );
}
