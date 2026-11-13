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

## Texts to send (Board)

The Board's **Texts to send** panel lists quote follow-ups (3 days after a quote is Sent, again every 7 days up to a month) and invoice chasers (7 days after an invoice is issued, again every 7 days until it's Paid). Each has a button that opens a ready-written text in Messages from your own number — a web page can't send it for you — then asks "Did you send it?" and only then hides it until it's due again. The wording can be edited (**Edit wording**, saved on that device). Run `supabase/migration-7-text-reminders.sql` once so "sent" is remembered; until then the texts work but keep showing.

## Today / Tomorrow (Board)

A panel near the top of the Board shows one day at a time (Today before 3pm, Tomorrow after, with a switch): the weather, each job (address, how long, call, directions) and each quote visit in time order. It reads the same schedule as the calendar and the iPhone feed. **Copy as text** gives a plain summary to paste somewhere. Code: `components/DaySheet.jsx`.

## Lead → quote

**Start quote** (on a lead, in the Visit planner, and on the Today/Tomorrow list) opens a new quote with the lead's name, phone, address (split into street and suburb, with QLD/NSW added) and job type filled in. Saving that quote moves the lead to **Quoted**, which also takes them out of the Visit planner. Code: `lib/leadToQuote.js`.

## Booking a job in (quote accepted)

Setting a quote to **Accepted** (or a client accepting it online) drops it into the next free working days after your booked jobs — and now **skips days the forecast says are wet** (heavy 15mm+ or wet 5mm+; the forecast reaches about 2 weeks). The same applies in the "Schedule accepted jobs" dialog. The date is only a suggestion — change it on the quote or the Board calendar. Once a job has a start date within 14 days, **Texts to send** offers a one-tap "you're booked in for …" text, and a "your start date has changed to …" text if you later move it (what the client was last told is remembered on the quote as `start:<date>` in `lastFollowUp`).

## Two-way calendar (hub ⇄ Google Calendar ⇄ iPhone)

A calendar *subscription* (the older iPhone link above) is read-only. For changes to go both ways, the hub keeps a Google Calendar in step and the iPhone Calendar app syncs with that. Jobs, site visits (with times), quote follow-ups and invoice due dates are mirrored. Move one on the phone and the hub's date/time changes; change it in the hub and the calendar follows. If both changed, the hub wins. Delete an entry on the phone and it stays deleted (the job/visit in the hub is untouched). A visit/job that no longer exists in the hub (lead lost, invoice paid) is removed from the calendar. The sync runs while the hub is open (on open, on coming back to it, every 2 minutes, and a few seconds after you save) and via the **Sync now** button in the calendar screen (top bar → calendar icon). Code: `lib/googleSync.js` (what to change), `lib/googleCalendar.js` (the API), `app/api/calendar/sync/route.js`.

**One-off setup**
1. [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. "Lyons Fencing Hub").
2. **APIs & Services → Library** → search **Google Calendar API** → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** (any name, skip the optional steps). Open it → **Keys → Add key → Create new key → JSON**. A file downloads — keep it private.
4. [calendar.google.com](https://calendar.google.com) → **Other calendars +** → **Create new calendar** (name it "Lyons Fencing Hub"). Open its **Settings → Share with specific people or groups → Add**: paste the `client_email` from the JSON file and give it **Make changes to events**. On the same settings page, copy the **Calendar ID** (under *Integrate calendar*).
5. Vercel → project → **Settings → Environment Variables**: `GOOGLE_SERVICE_ACCOUNT_JSON` = the whole contents of the JSON file, and `GOOGLE_CALENDAR_ID` = the Calendar ID. Redeploy.
6. iPhone: **Settings → Calendar → Accounts → Add Account → Google**, sign in, and make sure *Calendar* is on. In the Calendar app tick **Lyons Fencing Hub** under *Calendars* (if it isn't listed, tick it at calendar.google.com/calendar/u/0/syncselect).
7. Remove the older subscribed "Lyons Fencing Hub" calendar from the iPhone (Settings → Calendar → Accounts → Subscribed Calendars), or every entry shows twice.

## Site notes → draft quote

Write the notes from a site visit in the lead's **Notes** box, one job per line, in plain shorthand — e.g. `26m 1.8 colorbond raked`, `remove old fence`, `1 gate`, `20m 2.1 timber lapped and capped`, `3 posts`, `vegetation`, `excavator`. The lead form shows a live "Quote preview"; **Start quote** (on the lead, in the Visit planner, or the Today list) then opens a quote with those lines filled in at your usual template rates, the job length/height set, the standard notes added, and the client's details copied across. A "Drafted from your site notes" box lists what it assumed (e.g. butted paling if you didn't say lapped) and anything that needs a price (retaining walls have no template). Anything it doesn't recognise is ignored, so ordinary notes can sit alongside. Code: `lib/siteNotes.js`.

## Scan a receipt → expense

In **Finances → Log expense**, **Scan receipt** takes a photo (or picks one) of a fuel or tip receipt and fills in the amount (the GST-inclusive total), date, category (Fuel / Tipping/waste / Other) and a description like "Fuel — Ampol diesel 52.31L". The photo is read on the phone itself with Tesseract (free, nothing is uploaded; the reader downloads the first time it's used) and the result is only ever a suggestion — check it, then Save. Code: `lib/ocr.js` (reads the photo), `lib/receipt.js` (works out the expense).

## Visit planner suggestions

When a day is too full the planner now suggests concrete fixes ("Suggestions" panel): which visit to move and to which day (next ~10 days, no Sundays), why, and how much driving it adds. Visits with **no booked time** are suggested first; a visit that can't start until mid-afternoon is a natural one to move out of a packed day; a client with a booked time is only suggested when nothing else would help (at most one per day). The new day must fit their availability and not strain it, and a booked time doesn't carry over (the client has to be asked again). Buttons: **Move** (then **Save this day's times** to put the date on the lead and calendar), **Text {name}** (a ready-written "would {day} suit?" message from your own number) and **Not now**. Code: `suggestMoves` / `dayStrain` in `lib/visitPlanner.js`.

## What a client's text changes (and doesn't)

A text forwarded from the iPhone (or pasted with **Paste a text**) no longer gets copied into the lead's notes. Only the useful part is used: a street address replaces the lead's address (a changed street address leaves a one-line "Address changed by text (was: …)"), availability ("home by 3pm", "free from 3:30", "before 2") updates the "Available from…" line the planner reads, and a cancellation or a request to move the visit is kept as a short record so the planner and Board can flag it. Everything else ("ok thanks", "see you then") is ignored. "home/back/free by 3" means *from* 3; "done by 3" means *before* 3.

## Emailing clients (from the business Gmail)

**Email quote** (in a saved quote), **Email invoice** (in a saved invoice) and an **Email** button on each row in the Board's *Texts to send* (quote follow-ups, start-date emails and payment reminders) open a preview — who it goes to, the subject and the message (editable) — and nothing is sent until you tap Send. Quotes and invoices go with the PDF attached (a quote also has the online view-and-accept link; an invoice has your bank details). Sending a draft quote marks it Sent; sending a follow-up/reminder is recorded like the text version, so it drops off the list.

The address always comes from the email saved on that quote/invoice (copied from the lead when you "Start quote"; invoices copy it from their quote), or failing that the matching lead's email — never from the request. The endpoint only accepts calls from the hub's own pages, won't re-send the same document within 2 minutes, and stops at 40 emails a day (a no-login hub shouldn't be able to be used to email people from your business account). Code: `lib/email.js` (wording + sending), `app/api/email/route.js`, `components/EmailModal.jsx`.

**One-off setup**
1. Run `supabase/migration-8-email.sql` in the Supabase SQL Editor (adds `clientEmail` and `lastEmailed` to quotes and invoices).
2. On the business Google account (Lyonsfencingservices@gmail.com): turn on **2-Step Verification** (Google Account → Security), then **Security → App passwords** → create one (name it "Lyons Fencing Hub"). Google shows a 16-character password.
3. Vercel → Settings → Environment Variables: `GMAIL_USER` = `Lyonsfencingservices@gmail.com` and `GMAIL_APP_PASSWORD` = the 16 characters. Redeploy.

## Materials calculator — Colorbond bays and rakes

Colorbond runs are split into standard bays (2365mm rail, 3 sheets) plus, where it fits the length better, one long bay at the end (3125mm rail, 4 sheets): e.g. 24m = 9 standard + 1 long (31 sheets) rather than 11 standard (33 sheets). Each bay has 2 rails, 2 posts and 2 bags of concrete. Typing a bay width overrides this. Tick **Raked** (set automatically when the quote has a raked line) and a 1.8m fence lists the 2.1H sheets (cut down to follow the slope). Code: `colorbondBays` / `calcMaterials` in `lib/logic.js`.

## Reschedule requests and review requests

**Asked to reschedule:** when a client's text asks to move things ("can we do Monday instead?", "push it to next week"), the Board shows "N clients asked to reschedule by text" and the Visit planner shows an **Asked to reschedule** panel. For a quote visit it offers **Move visit to {the day they mention}**, **Move & text them** (opens a confirmation text), **Choose another day…** (the Move screen) and **Leave as is**; for a booked job (an accepted quote) it moves the job's start date the same way. Nothing moves until you tap — the day is only read from their text ("push back" never proposes an earlier day than they have now), and a "Checked: …" line in the notes clears the flag. Code: `rescheduleHint` in `lib/availability.js`.

**Review requests:** in **Texts to send**, a paid final invoice gets an "Ask for a review" row (text and, if they have an email, an email) from the day after it's paid for 3 weeks, once (remembered as `review:<date>` on the invoice). Put your Google review link in `BIZ.reviewUrl` in `lib/constants.js` (Google Business Profile → Ask for reviews → copy link) and it's added to the message.

## Dragging visits in the Visit planner

Hold the grip on the left of a visit (the time block) and drag it **up or down** to change the order of that day — the times re-work themselves around the new order (a "You set the order for this day — Back to the best route" line lets you undo it; if the order would miss a locked time the best route is shown instead). While you drag, a bar of the next days appears at the top: **drop the visit on a day** to move it there (saved straight onto the lead and calendar, with an Undo). The **Move…** button still does the same with a list of days and how each would fit. The dragged order is a planner setting on that device; **Save this day's times** is what writes times onto the leads. Code: `components/useVisitDrag.js`, `forceOrder` in `lib/visitPlanner.js`.

## Duplicating a quote and changing the size

On a quote, changing **Job length** or **Fence height** updates the rest of the quote: per-metre lines that were at the old length move to the new one (a line whose quantity you set yourself is left alone and mentioned), the "longer or shorter than 26m" note follows, and a fence line swaps to the matching template for the new height (same style, raked, lapped, sleeper) with its wording and rate — unless you've changed that line's rate or added a lot of your own wording, in which case it's left and flagged. The sleeper note is added or removed with it. If the quote has a shopping list, a **Recalculate it** link redoes it for the new size. There's no 1.5m or raked 2.1m template, so those say so rather than guessing. Code: `lib/quoteAdjust.js`.

## Several quotes or invoices in one email

When more than one goes in the same email, the subject stays plain ("Lyons Fencing & Services Quotes") and each PDF's title says which it is: height, material and length for a quote ("Quote Brendan Robina Colorbond fence 1.8m Colorbond (26m).pdf"), type and number for an invoice. Two that would read identically get their document numbers added.

## Leads from the inbox (hipages + email enquiries)
While the hub is open it reads the business Gmail (`app/api/leads/inbox`, `lib/hipages.js`, `lib/inboxLeads.js`) and keeps Leads up to date. It uses the same `GMAIL_USER` / `GMAIL_APP_PASSWORD` as the quote emails, over read-only IMAP: nothing is marked read, moved, labelled or deleted, and emails are never stored whole.
- **hipages:** when you accept a lead, hipages emails the client's details. Each one becomes a lead (source "hipages") with name, phone, email, suburb/postcode, job type and what they asked for in the notes. Invitations, reminders and message notices are ignored.
- **Direct email enquiries:** a first email from a person that reads like a fencing enquiry and gives a suburb/street or a phone number becomes a lead (source "email"), with a short cleaned-up copy of what they wrote (no quoted history or signatures). Replies, mailing lists, robots and spam-sounding emails never create leads.
- **Replies from a lead** (matched by their email address, or a phone number in the message) work like forwarded texts: an address updates the address, "free from 3:30" updates what the planner reads, a cancellation or a request to move the visit is kept as a record the planner flags. Anything else is ignored.

Someone already in Leads (same phone or email) isn't added again. Optional `supabase/migration-9-inbox.sql` lets it remember when it last looked; without it, it re-reads the last 3 days each time. An outside timer can also call `POST /api/leads/inbox` with the `x-api-key` header.

## Quote accepted / declined from a text or email
When a client's text or email makes it clear they're going ahead ("yep happy to go ahead", "we accept", "book us in", "when can you start?") or not ("we've gone with someone else", "too expensive", "no longer need it"), their quote moves to **Accepted** or **Declined** and the lead to **Won** or **Lost** (`lib/quoteDecision.js`, used by `/api/leads/inbound-text` and `/api/leads/inbox`). It's deliberately strict: a question, a hedge ("if", "but", "let me think"), or a bare "yes please" / "no thanks" does nothing, and it only acts when the client has exactly one quote with status **Sent** (with several it leaves them for you). A line in the lead's notes says what it did. An accepted quote with no start date shows up in the usual "accepted, needs a date" prompt. Emailing a Draft quote from the hub also marks it **Sent**, and the open quote window now follows that.

## Names filled in later
A lead with no name yet ("N/A", "Enquiry 04…") gets its name when a later text or email from that number/address introduces them ("it's Chen", "this is Chen", "Chen here", signing off "Thanks, Chen") — `lib/leadName.js`. Their draft/sent quotes (and invoices made from them) still showing the placeholder are renamed too. A real name is never changed.

## First text to a new lead
A new hipages lead shows at the top of **Texts to send** (Board) with **Write intro text**, and any lead with status New and a phone number has an **Intro text** button in Leads. It opens a draft in your wording ("Hey Des, It's Artie from Lyons Fencing & Services. I saw your post on Hipages…"; `lib/introText.js`, `components/IntroTextModal.jsx`). The job is guessed from the lead (Colorbond / timber / plain "fence installation" when it can't tell) and is a drop-down, and the whole text is editable. **Open in Messages** opens it from your own number ready to send — it is never sent automatically — then asks "did you send it?" and only then marks the lead Contacted. Wording is editable under Texts to send → Edit wording (a separate version for non-hipages leads).

Several quotes in one email: the PDF titles only name what differs — the length ("…Timber fencing 20.7m.pdf"), and the height only when the heights differ ("1.8m high").

Email addresses with an obvious misspelled domain ("hohotmail.com", "gmial.com", ".con") are caught before sending: the Email window warns and the server refuses to send, naming the likely correct address (`suggestEmail` in `lib/email.js`).

## Materials calculator and sleepers
A "w/ sleeper 2m" fence is a 1.8m fence on a 200x50 treated pine sleeper. In the calculator (ticked automatically when the quote has a sleeper fence line, or tick "On a 200mm sleeper") it uses the 1.8m palings or sheets, posts cut for the full 2m (the next stocked size up: 2.7m hardwood, 2.7H C post), and adds one sleeper per bay (2.4m; 3.0m for a Colorbond long bay). Sizes are picked from what is priced in the Materials list, so a 2m or 2.1m fence no longer ends up with $0.00 lines. The "longer or shorter than ...m" sentence in a quote now follows the job length even when its number was already out of step.

## Aluminium slat fencing (Oxworks)
Job type **Aluminium fencing**, priced from the Oxworks DIY concealed-fix slat system. The Oxworks items are in Materials (supplier "Oxworks", Inc GST, stock-colour "from" prices as of 25 Oct 2026 — the item code, e.g. VS5005, is in each name and is how the calculator finds the price, so keep it when editing). Quote templates: 1.8m fence with 65mm slats ($850/m) or 90mm slats ($800/m), plus 930 pedestrian ($2,000 / $2,100) and 1720 driveway ($2,500) gates. These are deliberately premium rates (about 40% over cost) because aluminium is not work Artie wants to win cheaply; a 6.5m run with a pedestrian gate comes to about $6,700 + GST. The calculator's **Aluminium slat** style works out slats (24 x 65mm or 18 x 90mm per 1.8m panel with 10mm gaps), 1-way/2-way posts, mullions, covers, caps, spacers, screws, post-mix concrete and the pre-fabricated gates, costing the 5800mm lengths bought (they can't be cut in store) so offcuts are included. Layout: post centres about 2.0m (3 slats from each 5800mm length), holes 200 x 600mm, about 2 bags of post mix per hole (as Oxworks specify). Job time is estimated at about 6m a day (`lib/jobSchedule.js`).

## Several quotes from one lead's notes
Write each separate quote as its own paragraph in the lead's Notes — a blank line between them, optionally with a heading line ("Right side", "Left side", "Front fence"). **Start quote** then drafts one quote per paragraph that has a fence in it and opens them one after another: saving one opens the next (**Skip this one** passes over one; closing the window stops the rest). A paragraph with no fence in it ("remove the old fence", "1 gate", "dog in yard") belongs to the quote above it, and notes with a single fence stay a single quote. The lead's Notes box previews how many quotes it will make (`parseSiteJobs` in `lib/siteNotes.js`, `quotesFromLead` in `lib/leadToQuote.js`). The notes parser also understands aluminium slat fencing now ("1.8m aluminium slat inc pedestrian gate 5m"), and a second height-sized number is read as a short length ("1.8m Colorbond flat 1.5m").

In the notes, "inc gate" means the measurement includes the gate: "1.8m Colorbond 26m inc pedestrian gate" is a 25m fence line plus one gate (about 1m is taken off for a pedestrian gate, 1.8m for a driveway or double gate, per gate); the removal line keeps the full length. Gate counts ignore the numbers in measurements, so the 8 in "1.8" is never read as eight gates.

More on writing notes for several quotes (see "Several quotes from one lead's notes"): an option written as "Colorbond or timber butted w sleeper 2m" makes one quote per option, with the rest of the line (the length, "raked", "inc removal") applying to both. A paragraph that starts "Another quote to …" becomes its own quote with that job as a custom line at $0 for you to price (the Gate rehang on Jill's notes). A line with only a length ("23.5m raked (up to the second shed)") followed by a line with only the fence ("Colorbond w sleeper 2m") is read as one job, and anything in brackets is shown in the draft banner as "From your notes".

## Leads whose client already has a quote
A lead can exist for a client who's already been quoted or booked in — typically a site visit to look at the job again before it starts (e.g. "Haydn (site visit)"). Those leads are matched to the client's quote by phone, email or name (a "(site visit)" or "?" on the name is ignored; `lib/leadQuotes.js`). While a non-declined quote exists, the lead no longer shows **Start quote**, **Intro text** or the Board's "new leads to contact" count, and instead says what the quote is ("Quote LFS485 accepted, starts 2 Nov"). Its site visit stays in the Visit planner as normal until its date passes or you mark the lead Won/Lost. The same name matching is used when a text or email says "yep go ahead".

## What counts as a lead (and what doesn't)
Importing from texts and email is deliberately picky:
- **hipages leads** keep only what helps you quote: what they asked for in their own words, plus an extra answer only if it adds something (a gate they do want, a length when they gave no exact one). The "hipages lead" header, the category, "No" answers and answers that repeat the description are left out.
- **Someone asking about work** (a labourer, apprentice or subbie: "I have experience…", "looking for work", "my previous boss", "willing to learn") is not a customer, so a text or email like that never becomes a lead.
- **Automated emails** never become leads: senders like deploy@, support@, admin@ or a machine address, hipages' own system emails (including the "Tom has indicated they would like your help" confirmation, which comes from a hipages server), and anything with template wording ("Customer Support Team", "Like us on Facebook"). A real enquiry must also be written in the first person ("I", "we", "our", "can you…").

Quote follow-ups are no longer calendar events (not on the Board calendar, Today/Tomorrow, the iPhone feed or the Google calendar): they are one-tap texts under "Texts to send" on the Board. The calendar shows jobs, site visits and invoice due dates.

Invoice due dates are no longer calendar events either: the calendar (Board, Today/Tomorrow, iPhone, Google) shows only jobs and site visits. Tapping a job or visit on the Board calendar or in "Coming up" opens that quote or lead straight away (`go(tab, { open: { table, id } })`), and Today/Tomorrow has Open quote / Open lead buttons. The Board's overdue-invoice and old-quote rows open the record directly when there is just one.

## Job time estimates and labour costs (from 26 Oct 2026)
With a labourer on board, jobs are estimated at **25m a day** (demo + install), or **20m a day** when the fence is raked, on sleepers, or lapped & capped / good neighbour. It's worked out line by line (so a quote with a flat line and a raked line adds up properly), rounded up to the next half hour, with 0.5m of grace and never less than 2 hrs for the fence. **Gates take 1 hr each.** Aluminium slat fencing is still about 6m a day. A duration typed on the quote still wins. If the typed job length is shorter than a fence line on the quote, the longer one is used. (`lib/jobSchedule.js`)

Every quote's costs now include labour: left blank, it's **1 labourer at $35/hr (cash) for the estimated hours**. Type employees and hours to override (0 employees for "just me"). The pay rate list is Labourer (cash) $35, Cash $40, ABN $50; quotes already saved with Cash or ABN keep those rates.

Aluminium on a wall: the calculator has "Posts fixed on top of a wall (base plates and anchors)" for toppers (posts cut to panel height, a base plate and four M8x70 anchors each, no concrete), and there is a template "Aluminium slat panels 550mm high on a wall (90mm slats)" at $325/m (a 5-row panel, 20mm gaps, about 550mm with the extra inch at the top). A topper job is estimated at about 18m a day, not the 6m a day of full-height aluminium.

Quotes and Invoices can be sorted: newest first (the default), oldest first, client A-Z, client Z-A, or highest value. The choice is remembered on that device, and it works together with the search box and status filter.

Materials calculator (timber): palings are counted per metre, not per bay: 10 a metre butted, 13 a metre lapped & capped (good neighbour) — `PALINGS_PER_METRE` in `lib/logic.js`. Gate palings use the same rate.

Hole depth in the materials calculator (timber and Colorbond): holes are 600mm deep unless the quote says otherwise. If a line or the notes say e.g. "900mm deep concrete footings due to the sand" (the deepest "NNNmm deep" counts), the calculator picks posts as deep as the holes (900mm = 2.7H C posts or 2.7m hardwood on a 1.8m fence) and 3 bags of concrete per hole (2 at 600mm, 3 at 900mm, 4 at 1200mm). The depth shows in the calculator and can be typed over. Post sizes the Materials list does not have (e.g. 3.0H) come out at $0.00 so you can see them.

## Materials worked out from the quote itself
"Calculate materials" on a quote now reads the quote's own lines (`lib/quoteMaterials.js`): each per-metre install line is a section with its own material, height, flat or raked, sheet height ("1800mm high Colorbond sheets"), sleepers and their height ("300mm of … sleepers" = 1.5 sleepers a bay, so 11m of raked fence on 5 bays is 8 × 2.4m sleepers), lapped & capped / good neighbour, hole depth ("900mm deep" = 2.7H posts and 3 bags a hole), aluminium panel counts ("5 panels", "2.3 metres apart") and gates. The sections are priced separately and added together, and the screen lists what it read so you can check it. **Work it out by hand instead** gives the old form. For anything the quote can't say (a bay that needs 2 × 2.1H sheets), use **Add or take off something** under the list: pick a material and a quantity, negative to take some off. Changing the job length or height on a quote recalculates the shopping list the same way.

Price lookups for concrete and gate frames now ask for the rapid-set bag and the "gate frame" by name, because the Oxworks items ("Concrete Fixing", slat "Gate") also contain the words "concrete" and "gate".

Follow-ups to the above: an aluminium topper "on a wall" now lists only what matching existing panels needs (slats, posts, base plates, the screws joining post to plate, and masonry screws to fix each plate down — price a "Masonry screw" in Materials to cost those); no mullions, covers, caps, spacers, concrete or anchors. Posts for sections of one quote share 5800mm lengths. Concrete is counted by the exact hole depth (600mm = 2 bags, 700mm = 2.33, 900mm = 3); the "w/ sleeper 2m" templates now say 700mm deep holes (a 2m sleeper fence = 2.7H posts). Write a bay that needs different sheets on the Colorbond line, e.g. "One bay will use 2 x 2100mm sheets" (or "2 sheets that are 2100mm"), and the calculator takes that many standard sheets off and adds that many of the taller size.

The aluminium topper list now includes post caps, and lists "wall plugs and batten screws" at no cost (price a "Wall plug" row in Materials if you ever want them costed). A Colorbond 2.4H custom-order sheet is in Materials at an estimated $35 each.

Quotes with Colorbond get a standard note: "Colorbond post caps are not included in the total cost. If you would like Colorbond post caps added to the quote, it will be an extra $5 per cap." (also on mixed quotes that have a Colorbond line).

## Invoices: adjust when sending
"Email invoice" (and any invoice Email button, including the chase emails under Texts to send) now has **Adjust the invoice before sending**: edit the lines (description, quantity, rate), add or remove a line, change the due date and the notes, see the new total, then **Save changes** and the email is rebuilt from the saved invoice (the PDF too). Send is switched off while an adjustment is unsaved. From the invoice edit screen, **Email invoice** now saves whatever you changed on that screen first, so the email always matches what you see.

## Lead notes from texts and emails: only the relevant parts
`lib/relevant.js` keeps the sentences that matter (size, height, material, access, dogs, timing, who to contact, money) and drops the greeting, thanks and signature. New leads from an email or a text get those lines as their notes (plain, so Start quote can read them, e.g. "About 30m long along the neighbour's driveway, 1.8m high."); later texts and emails from a lead add one short "Text <date>: …" line when they hold something worth keeping ("ok thanks" adds nothing). A number or email that belongs to a client with a quote but no lead (an accepted job, say) is kept on a lead under that client's name and status, never as "Enquiry 04…". "Timber slat" is timber: aluminium is only guessed when the words say aluminium, or "slat" with no timber mentioned.

## Labourer invoice (Invoices tab → "Labourer invoice")
Makes the invoice your sub-contractor labourer (Usher Jai Oakenfull, ABN 21 388 972 919, not registered for GST) sends you, billed to Artie Campbell Lyons (ABN 81 431 302 746). Defaults live in `lib/labourInvoice.js`: $35/hour, 30 min unpaid lunch off every day (Saturdays too), his bank details and phone number. The lunch is only worked out behind the scenes: the invoice just shows Date / Description (job address) / Total hours / Rate / Amount, the total and his bank details.
- Tap **6h–10h** to add the next day (skips Sundays) with that many hours, **Same as last** to repeat it, or **Fill the week (to Fri)** for the rest of the working week. Each day is a card with the date, hours and job address (address copies down from the day before); hours can be typed as `8`, `7.5` or a start–finish like `7-3:30`.
- **Text to Usher** opens Messages to his number with a ready message and a link to the invoice PDF (`/api/labour-pdf?d=…`, the link itself holds the invoice, nothing is stored). He opens it, saves the PDF and emails it to you for your records. Like the other texts it isn't sent for you (a web page can't), you press send in Messages. **Download PDF** is there too.
- Once an invoice is downloaded or texted it is **saved in the hub** (a row in the expenses table with category "Labour invoice", the invoice itself as JSON, so no database change) and shows under **Past invoices** on every device (PDF / Text again / Edit / delete). The next invoice starts automatically with the number one higher (1, 2, 3…). The draft you're typing and the rate/bank details are kept on the device. Invoices an older version kept only on one device are moved into the hub when that device next opens the screen.
- **Preview** shows exactly what the PDF will look like. The final-invoice deposit line now also says the amount including GST, e.g. "Less: deposit / part-payment already received ($292.60 inc. GST)" (the line itself is ex-GST, $266.00, and the GST total drops by the matching amount).

## Finances: income and estimated materials, by job and by week
The Finances tab no longer needs expenses logged. **Total income** is the paid invoices (inc. GST); **Expenses** are each job's estimated materials cost off its quote (what "Calculate materials" saved plus costed templates, inc. GST). Tap **Total income**, **Expenses** or **Net** for a breakdown: **By job** (tap a job for its quote total, invoices, what's still owing, materials and paid-less-materials) or **By week** (Monday to Sunday, tap a week for the lines in it). The page itself shows this week and last week and a chart of the last 8 weeks.
- Jobs are accepted quotes with their invoices (deposit and final are matched by quote, by the "per quote LFS…" in the notes, or by client name when they have one accepted quote). Invoices with no quote are listed as their own job.
- Materials are counted once the job is under way: from its start date (or, with no start date, when its first payment came in). Booked jobs that haven't started are listed but not counted. Jobs with no materials estimate saved count as $0 and are named at the bottom of the breakdown.
- Labour, fuel and tip fees aren't included. The old manual expense log is still there, folded away at the bottom, and isn't part of the numbers. Code: `lib/finances.js`, `components/FinanceBreakdown.jsx`.
- **Jobs started since:** the Finances tab only counts jobs that started on or after a date you pick (buttons for 2 weeks, 4 weeks, All time; it starts at 2 weeks back and is remembered on that device). A job's date is its start date, or its first invoice if it has none. Booked jobs that haven't started show a line under the cards: their deposits are in the income, their materials aren't in the expenses yet.
- **Labour is included in the expenses** (materials + labour). Labour is what's filled in on each quote: number of labourers (blank = one, 0 = just you) x hours (typed on the quote, otherwise the job-pace estimate) x the rate (labourer $35, cash $40, ABN $50), counted from the same start date as the materials. It is the quote's figure, not the labourer invoices (those are kept on the phone/computer you made them on). Fuel and tip fees still aren't in.
- **Labour in Finances comes from the labourer invoices.** Each day on an invoice goes to the job at that address (by street name; two jobs at one address share it by their estimated labour), in the week it was worked. Days that match no job show as "Labour, no matching job". A job from before his latest invoiced day with nothing billed on it counts no labour; a job after that day (not invoiced yet) uses the quote's estimate until he invoices it. Labourer invoices don't appear in the Logged expenses list.

## Board: money, hipages reply nudge, phone-text status (Nov 2026)
- **Money panel** at the top of the Board: *So far* (revenue = paid in, expenses = materials + labour of started jobs, profit) and *Projected* (every booked or started job's quote total against its full materials and labour, plus what's still to collect and what's out in quotes). Same numbers and the same "jobs started since" date as the Finances tab (default 18 Oct, kept per device).
- **Reply now** box: any hipages lead still New with no quote shows in red at the top of the Board with how long it has waited (minutes if it came in while the Board was open, otherwise the day it came in). The tab title shows the count, and **Turn on alerts on this device** gives a browser notification every 15 minutes while it's unanswered. These only work while the hub is open: the hub reads the inbox when it's open, so a lead that arrives while it's closed is only seen on the next open.
- **Texts from your phone**: the receiver notes the time each iPhone Shortcut text reaches the hub (and when one arrives empty) in a row in the expenses table (category "System", id "sys-text-in"; never the message). The Board shows it, so "failed" on the phone can be told apart from "never arrived".
- **Replies from an address the hub hasn't seen** (e.g. a repeat client writing from an email the quote never had): a reply is now read if the sender's name is a lead or client, or its subject mentions Lyons Fencing; it's matched to the one lead with that name (full name or first name) and its useful parts added to the notes.
- **Gates**: new templates "Colorbond/Timber pedestrian gate w/ post attached to fence" and plain "Colorbond/Timber pedestrian gate" (two posts in concrete; $1,050, change it if that's wrong). Site notes now default to the plain gate and only use a "post attached" gate when the notes say a gate post is attached to the house or the fence.
- **Quote wording (6 Nov 2026):** the Terms and conditions on every quote now include a social media line (we may film or photograph the works; tell us before works commence if you'd rather your property isn't included). New Colorbond quotes' notes also say the profile is Sawscreen unless requested otherwise and that the client must confirm the Colorbond colour before works commence unless the quote states it (`CB_PROFILE_NOTE`, `CB_COLOUR_NOTE` in `lib/logic.js`; also added to a timber or mixed quote that has Colorbond lines). Notes are only added to quotes made from now on; the terms show on every quote when it's viewed or sent.
- **Chain wire in the materials calculator:** a per-metre install line that says chain wire / chain link / chain mesh is now its own section ("28m · chain wire on hardwood posts and rails · 1.8m"): hardwood posts every 2.4m, hardwood 75x38 rails (3 lines, 4.8m rails span 2 bays), concrete, a 15m mesh roll per 15m, ties/bracing wire/tension bars by the metre (Materials row "Chain wire ties…", $3.50/m) and batten screws. Before this it read the line as a timber paling fence. Prices come from the Materials list (hardwood rail, "Black PVC Chain Wire Mesh 1.8m x 15m roll").

## Quote numbers, supplier invoices and phone alerts (Nov 2026)
- **Quote/invoice numbers** can't repeat any more: the next number is the saved counter or one above the highest LFS number in use, whichever is higher (an out-of-date phone or tab had reset the counter to 469).
- **Supplier invoices** (Finances → *Supplier invoices*): add a photo, screenshot or PDF from Our Town, Bunnings or anyone, check what was read, pick the job. That job's materials cost becomes what was really paid (in the week of the invoice) instead of the quote's estimate; with none added, the estimate still stands in. Invoices that match no job show as "Materials, no matching job". They're rows in the expenses table (category "Supplier invoice"). Reading the file needs an `ANTHROPIC_API_KEY` on the server (the route is `/api/ai/read-invoice`); without one the same screen works but the supplier, date, total and job are typed in (**Type one in**).
- **Phone alerts** (Board → *Phone alerts*): web push to the iPhone for a new hipages lead or enquiry, then a reminder 10 minutes later and every 30 minutes (up to 4) while a hipages lead from today or yesterday is still New with no quote. Set-up: (1) add `VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (the values are in `.env.local`) to the Vercel environment variables and redeploy; (2) add the hub to the iPhone Home Screen and open it from that icon; (3) tap **Turn on alerts**; (4) so the inbox is read while the hub is closed, set a free timer (e.g. cron-job.org) to `POST https://lyons-fencing-hub.vercel.app/api/leads/inbox` with the header `x-api-key: <PHONE_AGENT_API_KEY>` every 5 minutes. Code: `public/sw.js`, `lib/push.js`, `app/api/push/*`, `components/PushAlerts.jsx`.

## Hub password (Nov 2026)

The hub sits behind one shared password. Set `HUB_PASSWORD` in the Vercel environment variables (Settings → Environment Variables) and redeploy; until it's set the hub stays open so a deploy can't lock you out. Everything needs the sign-in cookie (`lfs_hub`, a year, httpOnly) except: the sign-in page, the quote accept page and `/api/accept/*` (clients), the calendar feed `/api/calendar/<token>` (has its own secret token), `/api/labour-pdf` (the labourer's invoice link) and the icons/manifest/`sw.js`. The phone-agent, inbound-text and inbox routes also accept the `x-api-key` header (`PHONE_AGENT_API_KEY`) in place of the cookie, so the phone agent, Shortcuts text forwarding and the cron-job.org timer keep working. Changing `HUB_PASSWORD` signs every device out (the cookie is a signature made from the password). Wrong guesses are slowed down and locked for 15 minutes after 8. Code: `middleware.js`, `lib/auth.js`, `app/api/login/route.js`, `app/login/page.js`. Each device (including the Home Screen app, which has its own cookies) signs in once.

**Morning texts alert (Nov 2026):** once a day, from 8am Brisbane (the first time the inbox timer runs after 8, until 5pm), if "Texts to send" has quote follow-ups, start-date texts, invoice chasers or review requests due, the phone gets one alert: "N people to text today" with the counts by kind. New hipages leads aren't in it (they have their own instant alerts). The list comes from `lib/dueTexts.js` (the same code the Board uses); the day it was last sent is kept in the expenses row `sys-digest`. Needs the same inbox timer as the other alerts. Review requests and invoice chasers now sort above quote follow-ups on the Board.

## Split a quote or invoice, shorter lead notes, timer reminder (Nov 2026)

- **Split in half** (button in the quote and invoice windows; invoices only while not paid): for two neighbours sharing a fence. Per-metre lines have the length halved, other lines are halved in price, credits like "Less: deposit" stay on the original client, and a new quote (Draft) or invoice (Unpaid, same job so it counts towards it) is made for the neighbour with their name/address/phone/email and the next number. Rules in `lib/splitDoc.js`, window in `components/SplitModal.jsx`. Emma's final invoice LFS525 was split this way (LFS528 is the neighbour's, named "Emma's neighbour (add name)" until edited).
- **Lead notes:** the enquiry stays as written; every later text or email reply is folded into ONE line, `Updates (latest 12 Nov): …`, instead of a line per message (`lib/noteSummary.js`). With `ANTHROPIC_API_KEY` set, Claude (claude-haiku-5-5) rewrites that line to take in each new message; without it the useful sentence or two of each message is kept (greetings, thank-yous, signatures and repeats dropped, last three kept). Emails already folded are remembered in the expenses row `sys-folded` so the 3-day inbox re-read can't fold one twice. Cancellations and "move the visit" messages are still kept as their own line so the planner can flag them.
- **Inbox timer reminder:** the inbox route records when a call with the `x-api-key` header last arrived (expenses row `sys-timer`); the Board's Phone alerts panel shows a "To do: set up the inbox timer" note until it's calling every few minutes, then a tick.

## Text client, "no removal", Future Fence (Nov 2026)

- **Text client:** a button on leads, quotes and invoices (and after an email is sent: "Text them to say it's sent") opens a ready-written text to their number in Messages from your own phone (`components/TextClientModal.jsx`). It can't send by itself (a web page can't); you check it and press send. Invoices find the number from the linked quote.
- **"No removal":** site notes saying "no removal", "without removal", "removal not needed" or "don't need the old fence removed" no longer create a removal line (`noRemoval` in `lib/siteNotes.js`), and a quote's "Old timber fence removed (m)" is only filled in when the quote has a removal line.
- **Future Fence** (futurefence.com.au aluminium batten panels, 2.2m wide, 40mm battens, 30mm gaps): template "Future Fence aluminium batten fence installation 1.8m" at $650/m ex GST with about $410/m materials (inc GST: panel $700, caps $50, brackets about $20, 50x100 in-ground post $109.95 per panel, concrete). The materials calculator still uses the Oxworks slat layout for aluminium, so for Future Fence use the template's per-metre materials.

## Supplier invoices by email, Fortress gate frame (Nov 2026)

- **From email:** the inbox reader (`app/api/leads/inbox`, every 5 minutes with the cron timer) also picks out emails with a PDF or photo that look like supplier invoices or receipts (a supplier name such as Our Town / Bunnings in the sender, subject or file name, or "invoice"/"receipt" in the subject or file name; Vercel, Anthropic, Stripe, hipages etc. are ignored). Claude reads each (`lib/readInvoiceAi.js`, same reading as the Add supplier invoice screen), and anything that's a real tax invoice waits on the Finances tab under **From your email, check these** with the job suggested from the delivery address; **Add to job** makes it a normal supplier invoice, **Skip** drops it. Waiting items are expenses rows `pend-…` (category System); emails already looked at are remembered in `sys-seen-sup`. Needs `ANTHROPIC_API_KEY`. Code: `lib/supplierMail.js`. A supplier email is never treated as a lead, and a failure here is caught so it can't hold up lead import.
- **Our Town** sends to a personal Gmail: set a Gmail filter there to forward their invoices to the business Gmail (Settings → Forwarding, add the business address and confirm it; then Filters, from the Our Town address, Forward to). Only matching emails move; the hub never gets the personal inbox. **Bunnings** doesn't email receipts: PowerPass app → E-Receipts → Share → email the PDF to the business Gmail (or add it with Add supplier invoice).
- **Timber gates** now say they have a galvanised steel gate frame; the gate frame material is the Fortress 1650mm E-frame end at $122.55 (Bunnings).

- **Boundary in the quote:** when site notes say which boundary a paragraph is about ("Back boundary 23.9m", "47.1m right boundary", "left and right boundaries"), the fence line reads "…fence along the back boundary at 1.8 metres high…" (and a removal line "…fence along the back boundary."), and the quote's title in the multi-quote batch is "Back boundary — 23.9m Timber" (`boundaryOf` in `lib/siteNotes.js`).

- **Review requests sooner:** the "Ask for a review" text now appears a day after the FINAL invoice goes out (the job is done by then), not only once it's paid (which can be weeks later and gets forgotten), and stays for 21 days. If the invoice is still unpaid once it's due for a chase (7 days), the review waits until it's paid. It's once per job: "Done" (or emailing the review) is remembered as `review:<date>` on the quote (or on the invoice when it's for someone other than the quote's client, such as a neighbour's half). Review requests sort straight under the start-date texts on the Board and are counted in the 8am "people to text" alert (`lib/dueTexts.js`).

## Route and fuel, timber sizes, big-job price (Nov 2026)

- **Route / fuel estimate** (the Estimate route button on a quote): now works out the real road distance first (job address from OpenStreetMap, route from the free OSRM service) from home (7 Matilda St, Burleigh Heads) via the tip (Reedy Creek) and the supplier (Our Town Yatala for Colorbond, Bunnings Burleigh for timber), and only asks Claude if the map lookup fails. Fuel = km × your L/100km × fuel price from Settings. Code: `app/api/ai/route-estimate/route.js` (fixed stops and their coordinates are at the top).
- **Timber sizes** in the standard notes: palings 100x16mm and rails 75x38mm (H3 treated pine), posts 100x75mm (H4 treated hardwood) (`lib/logic.js` suggestedNotes, `NOTE_SNIPPETS` in `lib/constants.js`).
- **Big job:** when a lead's site notes add up to 50m or more of fence (`BIG_JOB_METRES` in `lib/siteNotes.js`), the new-fence lines come out $5 a metre cheaper (`BIG_JOB_OFF`), e.g. lapped and capped 1.8m $195 -> $190, with a note saying so. Not applied to removal, gates, or quotes typed in by hand.

## Which side the palings face (Nov 2026)

Timber paling quotes carry one line in their notes saying which side the palings face (`lib/palingSide.js`, no database change; it shows on the quote the client sees): "Palings face the client's side." / "Palings face the neighbour's side." / "Palings side to be confirmed before works commence: please let us know which side…". New timber quotes start with the "to be confirmed" line (standard notes); if the lead's site notes say it ("palings facing the neighbour", "good side facing us") the quote gets that side instead. A **Which side do the palings face?** dropdown in the quote form changes it. For a booked timber job starting within 14 days that still doesn't say, **Texts to send** has a "Before the job starts" item with a ready text asking the client (and it's counted in the 8am alert); Done is remembered in the notes ("Asked which side the palings face (date)"). Also: "20m palings facing us" is now read as a 20m fence (a length with a unit before "palings" is no longer taken for a count of palings).

## Texts from existing clients (Nov 2026)

The iPhone Shortcut sends a saved contact's NAME, not their number, so a text from a client who has quotes but no lead (Jessie) matched nothing and was dropped as personal. Now (`app/api/leads/inbound-text/route.js`, `lib/leadQuotes.js`): a name is matched to a client with quotes when it's the same first name and only one client has it (`clientFromQuotesByName`); a text from a client (by name or number) that **asks for new work** ("can you quote…", "requesting a quote for 2 fence post replacements", "need a gate fixed"; not "thanks for the quote" or "it looks great", see `asksForNewWork`) becomes a **New lead** under their name, with the request as site notes so Start quote builds the draft (2 fence posts becomes "2 x hardwood fence post(s)"), and a phone alert ("New request: Jessie"). A lead that was Quoted, Won or Lost and then asks for new work goes back to New. Other texts from clients are kept in short as before. New enquiries from unknown numbers now buzz the phone too.

## Quote titles, Future Fence in notes, contact names (Nov 2026)

- **Title on quotes and invoices** (`title` column, `supabase/migration-10-title.sql`, run once in the Supabase SQL Editor): quotes made from a lead take their title from the notes ("Rear boundary — 23.9m Timber"); it shows as a badge in the Quotes/Invoices lists, under "Quote" / "Tax Invoice" on the PDF, in the PDF file name (replacing the generic job type), and carries to the deposit/final invoice and a split. A **Title** box in the quote and invoice forms edits it. Until the SQL is run, everything else saves and the title isn't kept (the banner says so).
- **Site notes** (`lib/siteNotes.js`): "future fence" or "batten" picks the Future Fence template ($650/m) and a gate "in future fence" the Future Fence gate ($2,100); different gates on the same notes (a Colorbond gate and a Future Fence gate) are separate lines; a length with a unit between 2.4m and 3m ("2.8m Colorbond fence @2m") is a length; the side is named per line ("11m front aluminium future fence", "left colorbond fence", "Back boundary" is written "rear") and put in that line's wording ("…fence panels along the front boundary at 1.8 metres high…"); the quote is named after it when every fence line in it is for the same boundary.
- **Saved contact names** (`matchContact` in `lib/leadQuotes.js`): a contact saved as "George Worongary" or "Jessie Burleigh" finds the lead or client: same first name, extra words must be in their name, address or suburb, and with two people sharing a first name it never guesses.

## Bill to (body corporate), Start quote saves, Future Fence prices (Nov 2026)

- **Make out to** (`billName` column, in `supabase/migration-10-title.sql` with `title`; safe to run twice): who a quote or invoice is made out to when that isn't the person you deal with. The contact stays "Jessie" (texts say "Hi Jessie"); the PDF's client box says "Gooding Drive Villas CTS 38702" with "Attn: Jessie" under it. It lives as one line in the lead's notes ("Bill to: …", `lib/billTo.js`), every quote made from the lead gets it, invoices made from the quote (deposit, final) carry it, and a split's neighbour copy doesn't. A client's email or text that says "can you put X in the invoice" / "amend the invoice to: X" / "make the invoice out to X" sets it on the lead by itself (`detectBillTo`, in the text route and the inbox reader). A **Make out to** box in the quote and invoice forms edits it.
- **Start quote** in the lead window now saves the lead (with anything you've just typed in the notes) first, and builds the quote from what's on screen, not from the last saved version.
- **A lead made for an existing client** (a text from someone with quotes but no lead) now takes the newest email and street address from their quotes AND invoices (`clientFromQuotes(quotes, who, invoices)`).
- **Future Fence prices** are in the Materials list (supplier "Future Fence"; names avoid the word "batten" and "frame" so they can't be picked up by the batten-screw or gate-frame price lookups).

- **Start quote for a returning client:** a lead whose client already has quotes used to have no Start quote button (and not count as a new lead). `coveredByQuote` (`lib/leadQuotes.js`) now treats a New or Contacted lead that came in AFTER the client's latest quote as a new request: it keeps the Start quote button and shows in the Board's new leads. A lead that goes back to New from a new request is dated today so the rule sees it.

- **A price written in the notes is used** (`priceIn` in `lib/siteNotes.js`): "2 fence post replacements $250 each", "20m lapped and capped $185/m", "26m colorbond 1 gate $1200" (a price after the word "gate" is the gate's), "$500 total" (spread over the quantity). Prices are ex GST like every rate on a quote, the quote's notes panel says "Used your price of $250 each… (the template price is $280)", and the big-job $5/m discount leaves a price you wrote alone. The hub only sees texts that CLIENTS send to you (your Shortcut forwards incoming messages); a price you text out never reaches it, so put it in the lead's notes.
