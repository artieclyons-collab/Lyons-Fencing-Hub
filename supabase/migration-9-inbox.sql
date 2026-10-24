-- Run once in the Supabase SQL Editor (optional but recommended) — for importing leads from the business inbox (hipages + email enquiries).
--
-- inboxCursor: when the hub last looked for new emails, so it only reads new ones and a lead you delete never comes back.
-- Without it the hub still works (it re-reads the last few days and skips anyone it already has).
alter table settings add column if not exists "inboxCursor" text;
