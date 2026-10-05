-- Run once in the Supabase SQL Editor — BEFORE the matching app update goes live.
--
-- Quotes: "employees" (people you pay, so not including yourself) and
--   "labourRateType" ("cash" = $40/hr, "abn" = $50/hr) replace crew size with a
--   single hourly rate. The old "crew" column is left in place so no existing
--   data is lost; the app just no longer uses it.
-- Leads: "visitDate" / "visitTime" for site visits, which feed the iPhone
--   calendar subscription.
alter table quotes add column if not exists "employees" text;
alter table quotes add column if not exists "labourRateType" text;
alter table leads add column if not exists "visitDate" text;
alter table leads add column if not exists "visitTime" text;
