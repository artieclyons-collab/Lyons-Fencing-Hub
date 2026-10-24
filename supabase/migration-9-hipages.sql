-- Run once in the Supabase SQL Editor (optional but recommended) — for hipages lead import.
--
-- hipagesCursor: when the hub last looked for new "hipages Job Details" emails, so it only reads new ones.
-- Without it the hub still works (it re-reads the last few days and skips anyone it already has).
alter table settings add column if not exists "hipagesCursor" text;
