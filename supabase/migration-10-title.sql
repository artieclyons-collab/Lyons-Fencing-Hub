-- Run once in the Supabase SQL Editor.
--
-- A title for a quote or invoice ("Rear boundary", "Left boundary"), so several quotes for the same client are easy to tell apart:
-- it shows in the lists, under "Quote" / "Tax Invoice" on the PDF, and in the PDF's file name.
-- Until this is run everything else still saves; the title just isn't kept.
alter table quotes add column if not exists "title" text;
alter table invoices add column if not exists "title" text;
