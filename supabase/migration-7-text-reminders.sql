-- Run once in the Supabase SQL Editor — BEFORE (or right after) the "Texts to send" update goes live.
--
-- Remembers when you last texted a client about a sent quote (lastFollowUp) or an unpaid
-- invoice (lastChase), so the Board stops showing it until it's due again.
-- Until this is run the texts still work; they just keep showing after you've sent them.
alter table quotes add column if not exists "lastFollowUp" text;
alter table invoices add column if not exists "lastChase" text;
