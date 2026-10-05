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
cp .env.local.example .env.local   # fill in Supabase URL + service_role key
npm run dev                        # http://localhost:3000
```

Without Supabase credentials the app runs in local-only mode (localStorage) and shows a banner saying so.

## Database setup

1. Create a Supabase project (free tier).
2. Open **SQL Editor** in the Supabase dashboard, paste the contents of `supabase/schema.sql`, and run it. This enables Row Level Security with no policies on every table — a default-deny lockout (see "How data access works" below).
3. Copy the **Project URL** and **`service_role` key** from Project Settings → API into `.env.local`. The `service_role` key is labeled "secret" — treat it like a password, it bypasses every protection on the database.

## How data access works

The browser never talks to Supabase directly. Every read/write goes through this app's own server routes (`/api/data/[table]`, `/api/accept/[id]`), which use the `service_role` key server-side (see `lib/supabaseAdmin.js`) to bypass Row Level Security. RLS itself is turned on with **no policies**, so the public `anon` key — which is not actually secret once the site is live, since it's visible in the deployed page — grants nothing. This is what closes off a Supabase-flagged "table publicly accessible" warning without needing a login system.

**Never** import `lib/supabaseAdmin.js` from a `"use client"` file — it must only be reachable from `app/api/**/route.js` handlers, which run exclusively on the server.

## Importing existing data

```bash
npm run import-data -- path/to/lyons-fencing-hub-export-YYYY-MM-DD.json
```

Upserts by id, so it's safe to re-run. Needs `SUPABASE_SERVICE_ROLE_KEY` set (the anon key no longer has write access once RLS is on).

## Optional: AI helpers

Price lookup, job-photo scanning and route-distance estimating call the Anthropic API through server routes. Set `ANTHROPIC_API_KEY` in `.env.local` (and in Vercel env vars) to enable them; without it those buttons show a friendly "not set up" message and everything else works normally.

## Deploying to Vercel

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project**, import the repo.
3. Add environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `ANTHROPIC_API_KEY`. Do **not** add `SUPABASE_SERVICE_ROLE_KEY` with a `NEXT_PUBLIC_` prefix — it must stay server-only.
4. Deploy. PDF export works out of the box on Vercel (serverless Chromium).

## iPhone calendar

The calendar button at the top of the hub gives a private subscription link (`/api/calendar/<token>.ics`). Subscribe once on the iPhone and Calendar shows job start dates (accepted quotes), site visits (set on a lead), quote follow-ups (3 days after a quote is marked Sent) and unpaid invoice due dates, each with reminders. It's read-only and iPhone refreshes subscribed calendars on its own schedule, so new entries aren't instant. The token is derived from `SUPABASE_SERVICE_ROLE_KEY`, so there's nothing extra to configure — but rotating that key changes the link, and anyone holding the link can see client names, phone numbers and addresses on it. The feed is built in `lib/calendarFeed.js`.

## Phone home screen

Open the deployed URL in Safari (iPhone) → Share → **Add to Home Screen**. The app ships a web manifest + icons, so it installs with the LF tile and runs full-screen.

## Notes

- No login screen (single-user tool, per the brief) — but the database itself is locked down independently of that (see "How data access works"). The app URL isn't a secret either way; anyone with it can use the hub as if they were you, since there's no login. Don't share the URL publicly.
- PDF export locally uses your installed Chrome/Edge; on Vercel it uses a bundled serverless Chromium.
