# Lyons Fencing Hub

Standalone web app for Lyons Fencing & Services — leads, clients, quotes, invoices, materials and finances. Ported from the original Claude artifact per the build brief: same UI and logic, but with a real database (Supabase), real PDF export, and deployable to Vercel so it can live on a phone home screen.

## Stack

- **Next.js** (App Router, JavaScript) + React
- **Supabase** (Postgres) for storage — falls back to browser localStorage if not configured
- **Puppeteer + @sparticuz/chromium** for one-tap PDF export of quotes/invoices
- **Vercel** for hosting

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase URL + anon key
npm run dev                        # http://localhost:3000
```

Without Supabase credentials the app runs in local-only mode (localStorage) and shows a banner saying so.

## Database setup

1. Create a Supabase project (free tier).
2. Open **SQL Editor** in the Supabase dashboard, paste the contents of `supabase/schema.sql`, and run it.
3. Copy the **Project URL** and **anon public key** from Project Settings → API into `.env.local`.

## Importing existing data

```bash
npm run import-data -- path/to/lyons-fencing-hub-export-YYYY-MM-DD.json
```

Upserts by id, so it's safe to re-run.

## Optional: AI helpers

Price lookup, job-photo scanning and route-distance estimating call the Anthropic API through server routes. Set `ANTHROPIC_API_KEY` in `.env.local` (and in Vercel env vars) to enable them; without it those buttons show a friendly "not set up" message and everything else works normally.

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo.
3. Add environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and optionally `ANTHROPIC_API_KEY`.
4. Deploy. PDF export works out of the box on Vercel (serverless Chromium).

## Phone home screen

Open the deployed URL in Safari (iPhone) → Share → **Add to Home Screen**. The app ships a web manifest + icons, so it installs with the LF tile and runs full-screen.

## Notes

- No login screen (single-user tool, per the brief). Anyone with the URL **and** the anon key baked into the page can read/write the data — don't share the URL publicly. If that ever becomes a concern, add Supabase Auth + RLS (`supabase/schema.sql` has a note).
- PDF export locally uses your installed Chrome/Edge; on Vercel it uses a bundled serverless Chromium.
