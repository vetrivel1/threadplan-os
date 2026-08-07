# threadPlan Demo Script

A ~18-minute walkthrough, in the app's own navigation order (ERP → Auto-Sequence
→ Auto Plan → Planning Rules → Methodology), built to land on the two claims the
problem statement cares about most: **pack-ratio-driven sequencing** and
**line allocation as a real decision**, not a planner's guess.

Runs against the seeded demo data as-is — every order number, date, and figure
below is what the app actually shows on a fresh load. If you've been poking at
the app beforehand, do a hard reset first (see below) so the numbers match.

---

## Before you start

- **Reset to a clean state.** Open the app in a private/incognito window, or
  clear `localStorage` for the site and reload. This clears any parameter
  tuning, publishes, or ripple edits from earlier testing so §5's numbers match
  this script exactly.
- **Do one full dry run** the numbers below (days late, hours of changeover,
  WIP) are pulled from the current seed and current default weights — if
  either changes, re-read the live numbers off the screen rather than reciting
  these from memory. Treat every number in this script as "approximately what
  you'll see," not a script to recite blindly.
- **Have two tabs ready:** one on `/orders` to start, one already on
  `/engine/methodology` scrolled to the top, so you can flip to it instantly in
  §6 without a slow page load mid-demo.
- **Know your audience's clock.** Section timings add up to ~18 minutes.
  §7 has a 10-minute cut if you're tight.

---

## 0. The hook (1 min) — say this before opening anything

> "Every scheduling tool sequences by delivery date. That's fine until you
> actually look at what closes a carton. A carton needs 10 small, 10 medium,
> 10 large — so a line that stitches 100 smalls first hasn't shipped anything.
> It's produced *work in progress*, not progress. Pack ratio and WIP are
> normally treated as two separate problems. In this engine they're the same
> calculation. That's the first thing I want to show you."

Then: "Second — with 20 to 30 lines, which line an order runs on isn't a detail,
it's a decision with real cost attached: changeover, colour sequencing,
per-line speed differences. This engine treats that as a decision variable the
system searches over, not something a planner eyeballs."

Open `/orders`.

---

## 1. Orders from ERP (2 min)

**What to show:** the order list as it actually arrives — size/colour
breakdown, pack ratio, and multi-material dates, not a single quantity and one
date.

- Point at **PO-2026-1103** (Fleece Hoodie): two colourways — Charcoal and
  Forest — each with its own size curve, and three separate materials (fleece
  body, drawcord + eyelets, care labels) each with its own in-house date.
  > "This order can't start until the *last* of these three lands, not the
  > first. That's a real gate, not a single date someone typed in."
- Point at **PO-2026-1118** (Jogger Pant): priority 5 — the most urgent
  priority flag in the seed — due in 12 days, solid-carton black. This is the
  order that gets interesting in §4.
- Click **Simulate ERP Order** (optional, only if you have time) to show a new
  order arriving live and immediately re-sequencing — this is what "auto-
  sequence runs on each new arrival" means in practice.

Click through to **Auto-Sequence**.

---

## 2. Auto-Sequence (3 min)

**What to show:** the engine is already choosing an order, not just sorting by
date — and it tells you *why*, plus what it can already see coming.

- Point at the ranked list. Note that priority and delivery date alone don't
  explain the order — that's deliberate: it's Critical Ratio (time left over
  work left), not delivery date, driving this.
- Scroll to **"Before you open Auto Plan"**. This is the section that
  surfaces, ahead of time:
  - Which orders are already on a **zero-slack critical path** (no stage has
    room to slip without moving the finish date).
  - The **most urgent material need** across every order — computed by a
    backward pass from each deadline, independent of the sequencing horizon.
  > "Neither of these changes the plan. They're the two questions a planner
  > would otherwise have to work out by hand before trusting it."
- Click **"Full detail on Planning Rules"** briefly to show it exists, then
  come straight back — you're taking the audience there properly in §5.

Click **Open Auto Plan**.

---

## 3. Auto Plan — the Gantt (2 min)

**What to show:** the day-by-day plan, and that RM gates and changeovers are
visible on the grid, not hidden in a tooltip.

- Scroll the Gantt horizontally — call out that **Order/Stage** and
  **Material Gates** stay frozen on the left as you scroll, so a wide plan
  never loses its row labels.
- Point at a cell where a line is idle waiting on material — this is
  **PO-2026-1103** or **PO-2026-1118**, both gated on a material that lands a
  few days out. The line simply isn't scheduled there yet; nothing is
  papering over the wait.
- Point at a colour changeover between two colourways on the same line — call
  out that switching to a *lighter* shade costs more than the reverse, because
  that's how a dyehouse actually plans a cleardown.

---

## 4. Record Actual Output → Cascade → AI Replan (5 min)

This is the section that shows the plan responding to reality, and shows AI
Replan is grounded in the same simulator as everything else — not a black box.

1. Click into a cell on an **early stage of an order already mid-run** (a
   sewing cell a few days in works well) and enter an actual quantity lower
   than planned — simulate the floor running behind.
2. The panel relabels to **"Record Actual Output."** Click **"Record & Preview
   Cascade."**
   > "Nothing is saved yet. This is a preview, overlapping the current plan
   > on the Gantt — dashed for what was planned, solid for what the cascade
   > now says."
3. If the cascade still lands late against a deadline, the panel offers
   **"Try AI Replan"** — click it.
   > "The cascade alone still misses the date. AI suggests overtime, a line
   > split, or a sequence swap — but it confirms this record first, then
   > opens recovery options. It doesn't get to pick both without you seeing
   > the intermediate step."
4. Walk through the four recovery cards:
   - **Add 2h overtime on sewing lines**
   - **Move this order to the front of the queue**
   - **Dedicate lines per order instead of sharing**
   - **Switch to solid-carton packing**
   > "Every one of these is priced by actually re-running the scheduler with
   > that change applied — not a canned percentage. The number you see next
   > to each card is what that specific change does to this specific plan."
5. Click **Apply Recommended** on whichever card is winning.
   > "This applies the exact same scenario definition the simulator just
   > priced — what you saw is what you get, not an approximation of it."

If a cascade doesn't trigger AI Replan on your first attempt (the order stays
on time), that's fine — say so plainly: "This one absorbed it without needing
AI help — that's the plan working as intended," and move on. Don't force a
crisis that isn't there.

---

## 5. Planning Rules & Parameters — the control surface (5 min)

This is the section that answers "how do I actually influence this, without
hand-editing cells?" — the core tension in the problem statement.

1. Land on `/engine`. Scroll to the **Planning parameters** panel.
   > "These seven sliders are the real trade-offs the scheduler makes.
   > Everything below on this page — the worked examples, the itemised
   > score — recomputes live off wherever these are set right now."
2. Move the **Lateness** slider up noticeably. Point out the rule cards below
   updating in place (no page reload).
3. Click **Replan Auto Plan & Auto-Sequence.**
   > "This is the one button that actually pushes a new plan to the floor —
   > everything before it was preview. It reports the improvement over a
   > naive delivery-date plan, and how many candidate plans it evaluated to
   > get there — typically 20-something, in milliseconds."
4. Click **Publish this plan.**
   > "Publishing freezes this sequence as the reference point. From now until
   > the next publish, the **Churn** weight has something real to measure —
   > it penalises re-sequencing orders that were already told to the floor,
   > which is the cost of a plan that keeps changing its mind."
5. Open one or two rule cards — **"Some orders are too small to get up to
   speed"** is a good one: it flags a specific order and the exact unit count
   needed before the line reaches target efficiency, with a merge
   recommendation if a same-style order is close enough in date to combine.
6. Point at **"Operators are slower on a new style"** and its **"Measured vs.
   modelled"** box.
   > "Right now every curve here is the modelled prior — a reasonable
   > starting guess. The moment a planner records real output through a
   > ripple edit, like we just did, this box starts saying which curves are
   > measured instead of guessed — and the plan gets more accurate the more
   > it's used, without anyone retraining anything."

---

## 6. Engine Methodology — the depth underneath (2 min)

Click the **"Engine methodology & formulas"** link at the top of the page.

> "Planning Rules explains what today's plan did with today's orders. This
> page is the mechanism itself — every formula, every constant, with a
> citation back to the exact function that implements it. It exists so a
> planning SME — or an engineer — can review, question, and sign off on the
> actual logic, not a marketing description of it."

- Scroll to the **overview** callout at the top:
  > "The core idea worth remembering: there's exactly one simulator and one
  > scoring function in this system. It's reused, unmodified, to rank
  > candidate plans, price the AI recovery options you just saw, run the
  > cut-off warning, and grade the plan on Planning Rules. One definition of
  > 'a good plan,' consumed everywhere — not four different heuristics that
  > happen to agree today and drift apart tomorrow."
- Scroll to the **Parameter reference appendix** briefly — every constant in
  the engine, its value, and its file, in one table.
- Scroll to **"What this deliberately does not model yet"** — don't skip this.
  > "This section matters as much as the formulas. It's an honest list of
  > what's out of scope today, so a reviewer can tell the difference between
  > a gap we've already found and a gap nobody's noticed yet."

---

## 7. Close (1 min)

> "Two things to take away. First: pack ratio and WIP aren't features bolted
> onto a date-sorted scheduler — they're the same measurement, and it drives
> sequencing directly. Second: line assignment across 20 to 30 lines is a
> search, evaluated by the same objective function every other decision in
> this system uses — not a planner's spreadsheet guess, and not a black box
> either, since every formula behind it is documented and traceable."

Open the floor for questions. If asked "what's not done yet," you already
have the answer memorized from §6 — use it; it reads as confidence, not a gap.

---

## If you only have 10 minutes

Cut to: §0 (hook, 1 min) → §1 (Orders, 1 min, one order only) → §3 (Gantt,
1 min) → §4 steps 1–4 only, skip Apply (3 min) → §5 steps 1–4 only (3 min) →
§7 (close, 1 min). Skip Auto-Sequence's insights callout and the Methodology
page entirely — offer to send the methodology link afterward instead of
demoing it live.

## Anticipated questions, and where the answer already lives

- **"Is this AI making the scheduling decision?"** — No. It's a deterministic
  simulator plus a search; walk them to `/engine/methodology` §0 if asked.
  The only place an LLM is involved is generating and pricing recovery
  *suggestions* in §4 — and even those are priced by the same deterministic
  simulator, not by the model's own judgment.
- **"Does this scale past 5 lines?"** — Yes, mention Phase 4 of the roadmap:
  benchmarked at 24 lines with per-line SMV and learning-curve overrides, same
  search speed, no combinatorial blowup.
- **"What happens to a planner's settings overnight / on another machine?"**
  — Honest answer: parameters persist to the browser's local storage today,
  not a shared per-organisation record yet. It's in the methodology page's
  gaps list (§6) on purpose.
- **"Can I trust the changeover / colour cost numbers?"** — They're a
  defensible estimate from style attributes (complexity gap, fabric type,
  colour lightness), built to be swapped for a factory's own measured data
  without touching anything downstream — say this plainly, it's a strength,
  not a weakness.
