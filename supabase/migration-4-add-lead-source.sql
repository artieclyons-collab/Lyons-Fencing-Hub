-- Run once in the Supabase SQL Editor.
--
-- Adds a "source" column to leads so rows created by the phone-agent webhook
-- (Vapi/Synthflow) can be told apart from leads entered manually in the hub.
-- Existing rows get null, which the hub treats the same as "manual".
alter table leads add column if not exists "source" text;
