-- Run once in the Supabase SQL Editor — BEFORE emailing documents from the hub.
--
-- clientEmail: where a quote/invoice is emailed. lastEmailed: when it was last emailed (stops accidental double-sends
-- and lets the hub keep a daily limit).
alter table quotes add column if not exists "clientEmail" text;
alter table quotes add column if not exists "lastEmailed" text;
alter table invoices add column if not exists "clientEmail" text;
alter table invoices add column if not exists "lastEmailed" text;
