-- Run once in the Supabase SQL Editor (safe to run again).
--
-- terms: this quote's own terms and conditions, one per line, when you've edited them for that quote.
-- Empty means the quote uses your standard terms. Until this is run everything else still saves; edited terms just aren't kept.
alter table quotes add column if not exists "terms" text;
