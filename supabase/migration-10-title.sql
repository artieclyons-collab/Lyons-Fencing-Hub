-- Run once in the Supabase SQL Editor (safe to run again).
--
-- title:    a title for a quote or invoice ("Rear boundary", "Left boundary"), so several quotes for the same client are easy to tell
--           apart: it shows in the lists, under "Quote" / "Tax Invoice" on the PDF, and in the PDF's file name.
-- billName: who the quote/invoice is made out to when that isn't the person you deal with (a body corporate, a company):
--           "Gooding Drive Villas CTS 38702". The contact stays "Jessie" for texts and emails.
-- Until this is run everything else still saves; these two just aren't kept.
alter table quotes add column if not exists "title" text;
alter table invoices add column if not exists "title" text;
alter table quotes add column if not exists "billName" text;
alter table invoices add column if not exists "billName" text;
