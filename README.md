# threadsPlan AI

Adaptive multi-stage apparel production scheduling SaaS. Replaces rigid spreadsheets with an intelligent auto-planning engine that handles shop-floor constraints, material gates, ripple cascades, and AI-powered recovery recommendations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js App (App Router)                    │
├──────────────┬──────────────────────┬─────────────────────────┤
│  Orders      │   Auto-Sequence        │   Auto Plan             │
│  (from ERP)  │   (ranked orders)      │   (Gantt + Ripple)      │
├──────────────┴──────────────────────┴─────────────────────────┤
│              Zustand Client Store + Demo Seed Data              │
├─────────────────────────────────────────────────────────────────┤
│  API Routes: /api/schedule  /api/ripple  /api/ai/recommend     │
│              /api/recovery/apply                                │
├─────────────────────────────────────────────────────────────────┤
│                    Core Scheduling Engine                       │
│  sequencing-policy.ts → ranking, risk windows, horizons         │
│  capacity.ts → SMV, learning curves, packing drag               │
│  scheduler.ts → multi-order priority, RM gates, stage deps      │
│  ripple.ts → lock cell + cascade recalculation                  │
├─────────────────────────────────────────────────────────────────┤
│              Multi-Criteria Optimization (MCOE)                 │
│  optimizer.ts → candidate plans, scoring, hill climbing         │
│  objective.ts → weighted trade-off between the criteria         │
│  changeover.ts / complexity.ts → setup cost, learning ramp      │
│  scenario.ts / recovery.ts → what-if and simulated recovery     │
├─────────────────────────────────────────────────────────────────┤
│  AI Co-Pilot (OpenAI + rule-based fallback)                     │
├─────────────────────────────────────────────────────────────────┤
│  Supabase PostgreSQL (multi-tenant RLS schema in supabase/)     │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
npm install
cp .env.example .env.local   # every value is optional
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and click **Continue in Demo Mode** —
no account is required and none is seeded.

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (flat config) |
| `npm run typecheck` | `tsc --noEmit` |

### Environment Variables

All optional — with none set, the app runs on in-memory demo data.

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Enables the LLM co-pilot. Falls back to rule-based options without it. |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase key (older projects) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase key (newer projects) — either name works |

Supabase activates only when a URL **and** one of the two key names are present.

## Key Features

### Multi-Stage Scheduling
Orders flow through **Knitting → Cutting → Sewing → Packing** with hard sequential dependencies.

### Dynamic Capacity Math
```
dailyOutput = floor(operators × shiftMinutes × efficiency / (SMV × packingDrag))
```
- **Learning curves**: operator efficiency ramps 55%→100% over consecutive style days
- **Packing drag**: assorted cartons apply 1.45× cycle time vs solid

### Material Gates
Orders cannot start before `rm_in_house_date`. Visualized as amber gate markers on the schedule board.

### Single-Cell Ripple — preview before commit
1. Planner edits one day's actual output
2. Engine computes the cascaded plan **without committing it**
3. The Gantt overlays the proposal: dashed ghost = current, solid "new" = proposed
4. Panel stays open with **Confirm Plan** / **Discard Preview**

### AI Co-Pilot
Contextual, not always-on. It surfaces **only** when a plan projects past a delivery
deadline — as *Try AI Replan* in the confirm panel, or a quiet *Recovery options* chip
when the committed plan is already late. Recommends overtime, sequence swap, line
split, or expedite, with one option highlighted.

## Try the Ripple Demo

1. Go to **Auto Plan** (`/schedule`)
2. Click any production cell (e.g. the Sewing row for PO-2026-1042)
3. Enter a lower actual output to simulate a miss
4. Click **Lock & Auto Replan** — compare ghost vs solid cells
5. **Confirm Plan**, or **Try AI Replan** if delivery is still at risk

## Database Schema

See `supabase/migrations/001_initial_schema.sql` for the full multi-tenant schema with RLS policies on:
- `organizations`, `profiles`, `production_lines`, `styles`
- `learning_curves`, `orders`, `schedule_cells`, `ai_recommendations`

## Supabase Setup (Production)

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run migrations in order in the SQL editor:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_realtime_and_auth.sql`
   - `supabase/migrations/003_seed_demo.sql`
   - `supabase/migrations/004_multi_line_cells.sql`
3. Enable **Realtime** for `schedule_cells` in Database → Replication
4. Add env vars to `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   OPENAI_API_KEY=sk-...
   ```
5. Sign up at `/login` — new users auto-join Aurora Textiles org

> **Not production-ready yet.** API routes have no auth check, every signup joins one
> hardcoded org, and RLS ignores the `role` column. See `HANDOVER.md` §6.

### Further reading

- [MCOE-ENGINE.md](MCOE-ENGINE.md) — the optimization engine: design rationale,
  scoring weights, Critical Ratio caveats, benchmark results, and what is
  deliberately not built yet.
- [HANDOVER.md](HANDOVER.md) — overall project state, flows, and known gaps.

Verify the engine with `npm run verify:parity` (regression gate against a golden
baseline) and `npm run benchmark` (per-criterion comparison).

### Demo Mode vs Live Mode

| Mode | How to access | Data |
|------|---------------|------|
| **Demo** | Click "Continue in Demo Mode" on login | In-memory, no persistence |
| **Live** | Sign in with Supabase credentials | PostgreSQL + Realtime sync |

## New in This Release

- **Preview-before-commit ripple** — proposed plan overlays the current one until confirmed
- **Contextual AI Replan** — surfaces only when a plan misses a delivery date
- **Centralised sequencing policy** — one source of truth for ranking, risk and horizons
- **Dual sewing lines** — scheduler splits volume across Sew Line A & B
- **Line-split recovery** — AI co-pilot "Apply" triggers a parallel sewing reschedule
- **Realtime** — collaborative cell updates via Supabase Realtime subscription

## Tech Stack

- **Frontend**: Next.js 16, TypeScript, Tailwind CSS v4, Framer Motion
- **State**: Zustand (client), demo seed data
- **Engine**: Pure TypeScript (portable to workers/edge)
- **AI**: OpenAI API with deterministic fallback
- **Database**: Supabase PostgreSQL (schema ready, demo mode default)
