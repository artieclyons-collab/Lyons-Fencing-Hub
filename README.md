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

## Visit planner

The **Visit planner** tab plans each day of quote visits: the best order (north to south, finishing near Burleigh), a time for each, the drive between them, and what to move if a day is too full. It uses free services: OpenStreetMap to find addresses, and OSRM for real driving times (plus a 20% allowance for traffic, since it doesn't know live traffic). Rules and the maths are in `lib/visitPlanner.js`.

- A lead with an address and a site visit date is planned. A lead with an address but no date gets placed on the best day. A name with a `?` after it is left out until confirmed.
- Availability written in a lead's notes is respected: `Available from 3:30pm onwards.` or `Needs to be done before 2pm.` The **Not before** box on a visit writes that line for you. Lines starting `Text ` (pasted or forwarded messages) are a record only, never instructions.
- Friday leaves Cleveland at 11am by default, and the plan leaves as late as it usefully can. Each day's start point, leave time and first-visit time can be changed on screen.
- **Move to Saturday** shows what it saves. **Save this day's times** writes the date and time onto each lead, so they show in the calendar and the iPhone feed.

**Job days:** on a day you're working a job (an accepted quote with a start date and an address), the plan starts from the job site when work finishes (you start at 7am by default, plus the job's hours for that day — both editable) and ends at home, 7 Matilda St Burleigh Heads. Visits with no day yet are placed on the job day where they cost the least detour on the way home. A visit whose client time falls while you're still working is done **mid-day**: the plan shows when to leave the job, when you're back, and pushes your finish time later by the time you're away. **Do mid-day** / **After work instead** on a visit overrides that. Code: `collectJobDays` in `lib/visitData.js`, `runPlan` in `lib/visitRun.js`.

**On my way:** works out your real ETA from your phone's location and opens Messages with a ready-to-send text from your own number (edit the wording under "Texts and your phone"). It can't send silently — a web page on an iPhone isn't allowed to — and a fully automatic send would need the Twilio number to be live.

**Client texts into the hub:** `POST /api/leads/inbound-text` with header `x-api-key` (same key as the phone agent) and JSON `{ "from": "<sender number>", "text": "<message>" }`. If the number matches a lead the text is added to their notes and any availability in it is picked up; anything else is ignored and not stored. On the iPhone, a Shortcuts automation ("When I receive a message" → Get Contents of URL, POST, JSON body with `from` and `text`) forwards texts to it. You can also paste a text by hand with **Paste a text**.

**Cancellations:** if a forwarded or pasted text sounds like the client no longer wants the quote ("don't need a quote anymore", "decided not to go ahead", "already found someone"), the Visit planner shows a **May have cancelled** panel and the Board gets a red attention row. Nothing is removed automatically — tap **Yes, take them out** (marks the lead Lost with a note, which drops them from the plan) or **No, still on** (adds a "Checked:" line so it stops flagging). Texts about moving the visit ("can we do Monday instead") aren't flagged. Each visit also has **Edit lead** and **Cancelled** (Mark lost / Delete / Keep) buttons. Detection lives in `lib/availability.js`.

## Phone home screen

Open the deployed URL in Safari (iPhone) → Share → **Add to Home Screen**. The app ships a web manifest + icons, so it installs with the LF tile and runs full-screen.

## Notes

- No login screen (single-user tool, per the brief) — but the database itself is locked down independently of that (see "How data access works"). The app URL isn't a secret either way; anyone with it can use the hub as if they were you, since there's no login. Don't share the URL publicly.
- PDF export locally uses your installed Chrome/Edge; on Vercel it uses a bundled serverless Chromium.
