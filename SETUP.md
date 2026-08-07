# Moving to a New Machine

Everything needed to pick this project up on a fresh machine, beyond what's
already in [README.md](README.md) and [HANDOVER.md](HANDOVER.md).

## 1. Clone

```bash
git clone https://github.com/vetrivel1/threadplan-os.git
cd threadplan-os
npm install
```

`main` is the only branch with current work. There is a stale remote branch,
`cursor/mcoe-optimization-engine`, from an earlier iteration of the
optimization engine — it predates several features now on `main` (bulk
output entry, batch briefing, colourway/material detail views) and should
not be merged. Safe to ignore or delete.

## 2. Environment variables

`.env` / `.env.local` are **gitignored on purpose** (they hold real secrets)
— see `.env.example` for the variable names. There are two ways to get
working values on the new machine:

### Option A — pull from Vercel (recommended)

The project is already configured on Vercel with all three variables set
for Production, Preview, and Development:

```bash
npx vercel login                 # if not already authenticated
npx vercel link                  # select vetrivel1/threadplan-os
npx vercel env pull .env.local
```

### Option B — copy manually

Copy your existing `.env` (or `.env.local`) file over from the old machine
through a secure channel (not git, not Slack). It contains:

- `OPENAI_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

All three are optional — with none set, the app runs fully in demo mode on
in-memory seed data (see README § Environment Variables).

## 3. Vercel project link

`.vercel/` is also gitignored. If you need to deploy from the new machine
(`vercel --prod`, `vercel env add`, etc.), relink it once:

```bash
npx vercel link
```

Project details, for reference:

- Project: `vetrivel1/threadplan-os`
- Production URL: https://threadplan-os.vercel.app

## 4. Supabase project

The Supabase project referenced by `NEXT_PUBLIC_SUPABASE_URL` already has
migrations `001`–`004` applied (see README § Supabase Setup). Nothing to
re-run unless you're pointing at a brand-new Supabase project.

## 5. Verify the move worked

```bash
npm run typecheck
npm run lint
npm run build
npm run dev          # http://localhost:3000
```

Click **Continue in Demo Mode** on `/login` to confirm the app runs even
before env vars are pulled/copied over.

## 6. Where everything else is documented

- [README.md](README.md) — architecture, scripts, features, tech stack
- [HANDOVER.md](HANDOVER.md) — product flows, code map, known gaps
- [MCOE-ENGINE.md](MCOE-ENGINE.md) — optimization engine design & benchmarks
- [DEMO-SCRIPT.md](DEMO-SCRIPT.md) — stakeholder demo walkthrough
- [KNIT-TO-PACK-ROADMAP.md](KNIT-TO-PACK-ROADMAP.md) — planned scope beyond MVP
