-- Run once in the Supabase SQL Editor for the materials shopping list and
-- digital quote acceptance features. Safe to re-run (IF NOT EXISTS guards).
alter table quotes add column if not exists "materialsBreakdown" jsonb default '[]'::jsonb;
alter table quotes add column if not exists "acceptedAt" text;
alter table quotes add column if not exists "acceptedByName" text;
