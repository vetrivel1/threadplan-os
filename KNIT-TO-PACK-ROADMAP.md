# Knit-to-Pack Roadmap

Sequenced plan for closing the gaps between `problem_statement.txt` (Draft v0.2,
4 Aug 2026) and the current engine. Phases are ordered so that each one lands on
a data model the next one needs, rather than by size.

Companion to `MCOE-ENGINE.md`, which documents the optimization layer this builds
on.

## The keystone insight

Two separate requirements in the statement turn out to be one calculation.

Pack ratio asks: a carton needs 10 small, 10 medium, 10 large, so stitching 100
small closes nothing. WIP asks: material accumulates on both sides of sewing
while every machine looks busy.

Units produced that **cannot yet close a carton are exactly the WIP sitting on the
floor**. One measure — carton shortfall by size — satisfies the pack-ratio
sequencing requirement and supplies the missing WIP term in the objective. Phase 1
therefore closes three of the thirteen gaps at once, which is why it goes first
despite being the largest.

## Phase 1 — Size and colour breakdown — **landed**

The unlock. Everything downstream of it is either mechanical or optional.

Measured on the fixture, same sequence and same lines, changing only how sewing
draws sizes:

| Size draw | WIP (unit-days) | Objective score |
| --- | --- | --- |
| Carton ratio | 437 | 124.2 |
| One size at a time | 13,907 | 151.14 |

Two things were deliberately left out of this phase. `PackingType` and the 1.45×
`PACKING_DRAG` still drive packing capacity, so this change touches sequencing
and measurement only — retiring the drag would move capacity as well and is
better done once ratio modelling is trusted. And `sizeMixPolicy` is an input
rather than something the optimizer searches, because ratio currently dominates
on every dimension; it becomes a genuine trade-off in Phase 2, when switching
size or colour starts costing changeover.

**Model.** An order stops being a scalar quantity:

```ts
interface SizeQty { size: string; qty: number }
interface Colourway { colour: string; thread?: string; sizes: SizeQty[] }
interface PackRatio { sizes: Record<string, number>; unitsPerCarton: number }
```

`Order` gains `colourways: Colourway[]` and `packRatio`. `quantity` stays as a
derived total so existing call sites keep working during the migration.

**Scheduler unit of work.** The decision that matters most here. Two options:

1. Keep the cell scalar, and attach the size/colour mix produced in that cell.
2. Explode cells to order × colourway × operation × line × date.

Take option 1. Carton closure only needs cumulative produced-by-size against the
ratio, which a mix vector per cell supplies. Option 2 multiplies cell count by
colourway count and would slow the optimizer's inner loop, which currently
evaluates 20 plans in about 16 ms — that speed is what makes the search viable.

**Objective.** Add one term behind a new physics flag:

```
cartonShortfall: units produced that cannot close a carton, summed per day
```

Sequencing pressure then emerges from the objective rather than from a special
case: a plan that stitches sizes in ratio scores better than one that runs 100
small first, with no bespoke rule.

**Retires.** `PackingType` and the 1.45× `PACKING_DRAG` scalar, which were
standing in for this. Deferred — see the note above.

**Verification.** `packRatioSequencing` off reproduces the golden baseline
exactly: `npm run verify:parity` still reports 73 identical cells, so the whole
change is attributable to the flag. The golden file itself did not need
re-capturing, because it pins legacy output and legacy output did not move.

## Phase 2 — Colour change and thread changeover — **landed**

Makes the statement's success criteria demonstrable.

**Colour became schedulable.** Phase 1 gave cells a size mix; a line is threaded
for one colour at a time, so cells now also carry the colourway they ran, and
each line works its own share of every colourway in turn. That single change is
what lets the rest of the phase be priced rather than asserted.

**The matrix is asymmetric on purpose.** Running a light shade after a dark one
needs a cleardown; the reverse does not. On the fixture's palette a sewing switch
from black to white costs 75 minutes and white to black costs 35. A symmetric
distance would price these the same and let the optimizer sequence dark-to-light
as cheaply as light-to-dark, which is the opposite of how a dyehouse plans.

Measured on the fixture, same sequence and same lines:

| | Changeover (h) | Objective score |
| --- | --- | --- |
| Colour ignored | 18.95 | 137.89 |
| Colour charged | 38.43 | 178.38 |

The first row is the plan a factory would publish if colour were free. The second
is what that same plan actually delivers. Half the changeover on this fixture was
previously invisible.

**Cartons now close per colour.** A Navy carton cannot be closed with White
pieces, so pooling sizes across colourways reported stock as shippable that the
floor could not pack. Correcting it moved carton-ratio WIP from 437 to 466
unit-days and one-size-at-a-time WIP from 13,907 to 4,346 — the second falls
because colour runs are short, which bounds how long a size imbalance can stand.
Ratio still wins by roughly nine to one.

**Mutations.** `changeColour` recolours one colourway. `splitOrder` divides an
order in two, each keeping the full size curve so both halves can still close
cartons, with the split-off part free to take its own deadline. `changeQuantity`
now rescales the size and colour profile rather than only moving the total.

**What the split demo shows.** Taking 1,200 units out of the at-risk jogger pulls
its first shipment in four days and lifts every order behind it, but the tail
becomes a short run of its own and misses its later date. The engine surfaces the
trade instead of hiding it: splitting buys the near deadline at the cost of the
far one.

**Verification.** `colourChangeover` off, with `packRatioSequencing` off,
reproduces the golden baseline exactly — `npm run verify:parity` still reports 73
identical cells.

## Phase 3 — Configured routing operations — **landed**

Wide but mechanical, and it must precede Phase 4 so per-line SMV is not threaded
through a hardcoded `Record<StageCode, …>` twice.

**What changed.** Whether an order visits a stage used to be implicit: every
order ran all four hardcoded stages, and "cutting is always in the route" was a
fact about the code, not a fact about the factory. A `RouteTemplate` names the
operations a style runs, in order, and `Style.routeId` picks one. Two are
shipped — `knit-to-pack` (knitting → cutting → sewing → packing, the original
behaviour, and still the default) and `cut-to-pack` (cutting → sewing → packing,
for fabric that arrives bought rather than knit in-house). The Basic Tee is
seeded onto `cut-to-pack`, since jersey is typically bought as dyed roll goods.

Two bugs would have shipped without the fixture catching them:

- The scheduler chained each stage off "the previous entry in `STAGE_ORDER`",
  which is correct only when every style runs every stage. A route that skips
  knitting needs cutting to chain off nothing, not off knitting's absent
  completion date — fixed by finding the previous stage *within the route*,
  not the global pipeline.
- Zeroing a skipped stage's SMV looked like the obvious way to mark it inert,
  but `dailyLineCapacity` treats `smv ≤ 0` as *zero capacity forever*, not
  *skip*. The Basic Tee's knitting SMV stays on file at its real rate; the
  route is what makes it unread, not the number. Confirmed by the parity
  check silently breaking on the first attempt — LEGACY_PHYSICS ignores
  routes entirely, so it still asked for a knitting rate that no longer
  existed, and stalled.

**Measured on the fixture** — same order, same lines, only the route changed:

| Route | Basic Tee completes | Knit-line days worked |
| --- | --- | --- |
| cut-to-pack (actual) | unchanged | 9 |
| knit-to-pack (forced) | unchanged | 15 |

The completion dates hold steady here because sewing, not knitting, is this
order's binding constraint — the route change doesn't fabricate urgency where
none exists. What it does move is real: six fewer days of knitting-line
occupancy, freed for orders that actually need it.

**Also added:** `linking`, `finishing`, `wash` and `dispatch` as recognised
operations — labelled, coloured, and priced for changeover — so a route can
name them once a factory profile needs to. None is in either shipped template
and none has a seeded line, so they are inert today by construction, the same
way an unmodelled stage always was; giving them real capacity is Phase 4 work,
not a routing concern.

**Deferred.** Genuine per-organisation configuration — an admin surface where
a customer defines their own operations rather than picking one of two shipped
templates — needs a place to configure it, which doesn't exist yet. Phase 7
already sets aside the parameter-surface question; this would live there
rather than being built ahead of a consumer.

**Verification.** `configuredRouting` off makes every style's route resolve to
the full legacy `STAGE_ORDER`, ignoring `routeId` entirely — this is *why*
`verify:parity` still reports 73 cells identical to the golden baseline, not
an assertion made independently of it.

## Phase 4 — Scale to 20–30 lines, with per-line curves — **landed**

**What changed.** SMV and learning curves were keyed by style alone, which
quietly assumed every line runs a style at the same rate — true only because
the demo has one sewing line pair with nothing to tell apart. `Style.lineSmv`
is a sparse per-line override map (`{ "line-sew-1": { sewing: 16.5 } }`);
absent means "use the style-wide rate", so most lines need no entry at all.
Learning curves gained the same idea through a compound key: `getLearningEfficiency`
now checks `${styleId}:${lineId}` before falling back to `styleId`, then the
complexity-tier prior. Both are gated behind a new `perLineRates` physics flag
(on by default, off under `LEGACY_PHYSICS`) for the same reason `configuredRouting`
was gated in Phase 3 — the golden fixture needed to grow a real override without
the parity baseline moving.

Seeded one illustrative pair rather than an exhaustive matrix: the Fleece
Hoodie's Sew Line A has a modern overlock station (16.5 vs. the style's 18.2
sewing SMV) and operators who've already run this style, so it also gets a
faster-climbing curve; Sew Line B is older tooling and runs slightly behind
the style-wide rate (19.0). Authoring a rate for every style × every one of 24
lines would be make-believe precision with no source data behind it — the
mechanism only needs to exist and be demonstrably correct, not be exhaustively
populated ahead of real factory data.

**Scale.** A separate 24-line roster (`SCALED_LINES` in `scripts/fixture.ts`:
6 knitting, 6 cutting, 8 sewing, 4 packing, weighted toward sewing the way a
real knit-to-pack factory is) is used only by the benchmark's scale section —
deliberately *not* merged into `FIXTURE_LINES`, because adding lines changes
how `spreadAll` divides an order and would fail the golden-file comparison for
reasons that have nothing to do with a regression. The interactive demo
(`src/lib/seed/demo-data.ts`) also keeps its original 5-line roster for now:
growing the live Gantt to 24 mostly-idle lines is a product decision about
what a planner should see by default, not a scheduling-correctness question,
and is left for whoever owns that screen to decide deliberately rather than as
a side effect of this phase.

**Measured on the fixture** — same 5 orders, same sequence search, only the
line count changed:

| Lines | Plans evaluated | Wall clock | Objective gain vs. baseline |
| --- | --- | --- | --- |
| 5 (fixture) | 20 | 28 ms | 373.68 |
| 24 (scaled) | 20 | 26 ms | 29.91 |

No pruning or hill-climb cap was needed — the search stayed just as fast at
24 lines. The lower objective gain at scale isn't a regression: with five
times the sewing capacity, the naive deadline+spreadAll baseline is already
close to optimal, so there's less congestion left for the optimizer to buy
back. The interesting number isn't runtime, which was never the bottleneck at
this order count — it's that `dedicate` correctly routes the Fleece Hoodie to
the lower-SMV line (`line-sew-1`, 16.5) over the higher one (`line-sew-2`,
19.0) instead of just whichever is free first, which is the actual "line
assignment as a decision variable" claim this phase exists to back up.

**Deferred.** The branching-factor concern in the original phase description
assumed `buildAssignments` would consider combinations of lines per order;
it doesn't — `pickLine` is a greedy single-best-line choice, so cost scales
linearly with line count, not combinatorially. If a future phase adds genuine
multi-line combinatorial search (e.g. trying every subset for `spreadAll`-style
splitting), revisit pruning then; today's numbers don't justify it.

## Phase 5 — Learning curves that learn

The data is already captured; only the feedback loop is missing.

- Fit an observed curve per style × operation × line from recorded daily output.
- Blend observed against the complexity-tier prior, weighted by observation count,
  so three data points do not overwrite a sane default. Shrinkage toward the prior
  is the whole trick here.
- Surface which curves are measured and which are still modelled — a planner will
  ask.

Depends on Phase 4 for the per-line key.

## Phase 6 — The three missing outputs

Independent of the phases above; can slot in wherever there is capacity.

- **Critical path.** Longest chain through operations for an order under capacity,
  flagged on the plan.
- **Cut-off warning.** The latest date a change can still be absorbed. Computable
  by testing feasibility as a function of insertion date and binary-searching for
  the boundary — the engine already answers the inner question.
- **Suggested material in-house dates.** Backward pass from each planned operation
  start, minus buffer, staggered per material. Inverts today's input-only flow and
  is what answers procuring yarn for panels knitted three months out. Also raise
  the 45-day sequencing horizon.

## Phase 7 — Operating-model alignment

Product framing rather than engine work, and worth settling with the customer.

The statement is explicit that the plan is not hand-edited: outcomes change by
adjusting planning parameters or ERP dates. The demo's headline interaction is
editing a cell.

- Build the parameter surface — scoring weights, buffers, strategies — as the
  primary lever, replacing cell editing.
- Reframe cell entry as recording daily output, which is in scope, rather than as
  a planning action.
- Add the end-of-day replan cadence and a published-plan freeze, so churn is
  measured against something real.

## Sequencing rationale

| Phase | Why here |
| --- | --- |
| 1 | Unlocks pack ratio, WIP and colour; everything else assumes its model |
| 2 | Shares Phase 1's model; makes the success criteria demonstrable |
| 3 | Must precede 4 so per-line SMV is threaded once, not twice |
| 4 | Needs configured operations; makes the allocation claim credible |
| 5 | Needs Phase 4's per-line curve key |
| 6 | Independent — schedule against team capacity |
| 7 | Needs customer agreement, not engineering sequence |

## Verification for every phase

The existing harness makes each step auditable, so keep using it:

1. Add the change behind a `PhysicsOptions` flag, defaulting off.
2. `npm run verify:parity` must still reproduce the golden baseline with the flag
   off. This is what proves the change is attributable.
3. Turn the flag on, re-capture the baseline, and record the movement in
   `npm run benchmark` so each phase has a measured before and after.

## Open dependency

The statement's first open point still blocks any improvement claim: without the
customer's current on-time delivery rate, WIP days on floor and planning cycle
time, the benchmark can only show the engine works against seed data — not that it
improves this factory.
