# ThreadPlan OS — Handover

Context document for picking this project up in a fresh session.

---

## 1. What this is

**ThreadPlan OS** — a multi-tenant SaaS for apparel production scheduling. It replaces
spreadsheet planning with an engine that models real shop-floor constraints: SMV per
stage, operator learning curves, packing drag, raw-material gates, and multi-order
capacity contention across production lines.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Zustand · Framer Motion ·
Supabase (optional) · OpenAI (optional).

The app runs fully in **demo mode** with in-memory seed data when Supabase is not
configured. This is the mode used for stakeholder demos.

---

## 2. Product flow

```
ERP Orders  →  Auto-Sequence  →  Auto Plan  →  (only if late) AI Replan
 (read-only)   (rank orders)     (daily Gantt)   (recovery options)
```

| Screen | Route | Purpose |
|--------|-------|---------|
| Orders from ERP | `/orders` | Read-only order intake + "Simulate ERP Order" |
| Auto-Sequence | `/auto-sequence` | Ranked order list with planner-readable reasoning |
| Auto Plan | `/schedule` | Day-by-day Gantt, ripple edits, AI recovery |
| Login | `/login` | Supabase auth + "Continue in Demo Mode" |

`/` redirects to `/orders`.

### Auto-Sequence vs Auto Plan

These are different layers and the distinction matters:

- **Auto-Sequence** decides *which order goes first*. Runs when ERP orders arrive.
- **Auto Plan** decides *what each day produces*. Where planners live day to day.

A ripple replan does **not** re-rank the sequence — it keeps order priority and
reschedules the calendar around locked actuals. Only a new ERP order (or an explicit
AI sequence-swap) changes ranking.

---

## 3. Key flows to know

### Ripple edit — preview before commit

Nothing is persisted until the planner confirms:

1. Click a Gantt cell → side panel opens
2. Enter actual output → **Lock & Auto Replan**
3. Proposed plan is computed client-side into `pendingCells` (not committed)
4. Gantt overlays the proposal: dashed ghost = old qty, solid "new" = proposed
5. Panel stays open with **Confirm Plan** / **Discard Preview**
6. If the proposal still misses a delivery date, **Try AI Replan** appears

Pending state is cleared on confirm, discard, navigate-away, hydrate,
`simulateErpOrder`, and `applyRecovery`. Realtime updates are paused while a preview
is open so the baseline can't shift under the overlay.

### AI Replan is contextual, not always-on

It appears **only** when warnings contain `"past delivery deadline"`:

- **Primary entry:** "Try AI Replan" in the ripple confirm panel
- **Secondary:** a quiet "Recovery options" chip when the *committed* plan is late

There is deliberately no permanent header AI button.

---

## 4. Code map

### Engine — `src/lib/engine/`
| File | Responsibility |
|------|----------------|
| `sequencing-policy.ts` | **Single source of truth** for ranking + risk + horizons |
| `scheduler.ts` | `buildSchedule` — stage precedence, RM gates, line allocation |
| `ripple.ts` | Lock a cell and cascade the remainder |
| `capacity.ts` | SMV, complexity, learning curve, packing drag |
| `run-sequence.ts` | Thin wrapper used by Auto-Sequence |

Capacity formula:
```
dailyOutput = floor(operators × shiftMinutes × efficiency / (SMV × packingDrag))
```

### Data — `src/lib/data/`
- `repository.ts` — Supabase queries with demo fallback; org-scoped
- `mappers.ts` — DB row ↔ app type conversion

### State — `src/lib/store/schedule-store.ts`
Zustand store. Notable actions: `previewRippleEdit`, `confirmRippleEdit`,
`discardRippleEdit`, `simulateErpOrder`, `applyRecovery`, `hydrate`.

### Database — `supabase/migrations/`
`001` schema + RLS · `002` realtime + auth trigger · `003` demo seed · `004` multi-line cells

---

## 5. Current state

Typecheck, lint, and production build all pass:

```bash
npm run typecheck && npm run lint && npm run build
```

### Recently fixed (verified against demo data)

**Engine correctness:**
- Sewing was scheduling **2× the order quantity** — each line received the full qty
  instead of a share. Now splits correctly and sums exactly.
- Two orders could book the same line on the same day (off-by-one on line-free date).
- A line that ran out of horizon with work left didn't mark itself occupied.
- Line-split ratios bound by array position instead of line ID (80/20 came out reversed).
- `Math.ceil` per-line allocation overshot the total; now largest-remainder.
- Replan re-scheduled quantity that was already locked before the window.
- Ripple cascade detection ignored `lineId`.

**React / state:**
- `CopilotPanel` refetched the AI endpoint on *every* store change (`cells` in deps).
  Now uses stable primitives + `AbortController`.
- Pending preview survived navigation, hydrate, and ERP simulate.
- Realtime cell merge ignored `lineId`; double-click could double-submit a confirm.
- Preview and server used different order-status rules.

**Security / tooling:**
- `.env` used `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` while code read
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` — **Supabase silently never activated**. Both names
  now accepted via `src/lib/supabase/env.ts`.
- Open redirect on post-login `?next=` / `?redirect=`.
- `/api/ripple` and `/api/recovery/apply` now validate inputs and verify the order exists.
- `next lint` was removed in Next 16 and `eslint.config.mjs` held invalid JSON —
  both fixed; `npm run lint` works.

---

## 6. Known gaps — decisions needed

These are deliberate open items, not oversights.

### Security (blocking for production, fine for demo)
1. **API routes have no auth.** Middleware skips `/api/`. Unauthenticated writes
   currently land in demo mode rather than the DB, but that's accidental.
   `/api/ai/recommend` will spend the OpenAI budget for any caller.
2. **All signups join one hardcoded org.** The `handle_new_user` trigger assigns every
   new user to `aurora-textiles`. Tenant isolation in queries is correct; the
   *bootstrap* is missing.
3. **RLS ignores `profiles.role`** — a `viewer` can write.
4. `persistCells` upserts without deleting cells a replan dropped (stale rows).
5. No concurrency control — two planners can lost-update each other.

### Correctness
6. **Supabase-mode confirm re-runs the ripple server-side** rather than committing the
   exact preview, so a concurrent change could make the commit differ from what was
   previewed. Demo mode commits the preview exactly.
7. Stage precedence waits for **full** previous-stage completion — no pipelining.
   Conservative but not how real factories flow.
8. If a stage can't complete within the horizon, downstream stages still schedule the
   full quantity.

### Product
9. **Configurable sequencing rules — ON HOLD pending customer review.**
   Phase 1 (extract policy to one place) is **done**. Phase 2 would add a per-org
   weighted rule config seeded to today's behavior; Phase 3 a settings UI with live
   rank preview. Recommendation: weighted scoring for *soft* rules only — keep hard
   constraints (RM gate, stage order, capacity) in code. Do **not** build a DSL.

---

## 7. Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

No credentials exist — **click "Continue in Demo Mode"**. There is no seeded user;
`planner@aurora-textiles.com` on the login page is placeholder text only.

Note: now that the env-var fix landed, a populated `.env` will actually activate
Supabase and show the email/password form. Signup requires email confirmation unless
disabled in the Supabase project, and needs migrations `001`–`004` applied.

### Demo script for stakeholders

1. **Orders** — show read-only ERP intake, click *Simulate ERP Order*
2. **Auto-Sequence** — ranked list with SMV / learning-curve reasoning
3. **Auto Plan** — RM gate markers; click a cell, lower the actual
4. **Lock & Auto Replan** — ghost vs solid overlay, then *Confirm Plan*
5. **Try AI Replan** — appears only if delivery is still at risk
