-- Run once in the Supabase SQL Editor — BEFORE the matching app update goes live.
--
-- Quotes: "durationHours" is a job duration typed on the quote (overrides the
--   automatic estimate; 8 hours = a full day), and "workSaturday" ("yes") lets
--   that job run over a Saturday. Both are optional — blank means "use the estimate"
--   and "Monday to Friday only".
alter table quotes add column if not exists "durationHours" text;
alter table quotes add column if not exists "workSaturday" text;
