-- Lyons Fencing Hub — database schema
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
--
-- Column names are quoted camelCase so rows match the app's data shapes exactly.
-- Most fields are text on purpose: the app treats them loosely (e.g. "10" vs 10)
-- and does its own Number() coercion, so text avoids type friction entirely.
-- "inserted_at" is bookkeeping for stable ordering (newest first, like the artifact).

create table if not exists leads (
  id text primary key,
  "name" text,
  "phone" text,
  "email" text,
  "address" text,
  "jobType" text,
  "status" text,
  "notes" text,
  "createdAt" text,
  inserted_at timestamptz not null default now()
);

create table if not exists quotes (
  id text primary key,
  "docNumber" text,
  "clientName" text,
  "clientPhone" text,
  "address" text,
  "suburb" text,
  "jobType" text,
  "status" text,
  "date" text,
  "startDate" text,
  "validUntil" text,
  "depositPercent" text,
  "items" jsonb default '[]'::jsonb,
  "notes" text,
  "distanceKm" text,
  "crew" text,
  "hours" text,
  "removalLength" text,
  "materialsCost" text,
  "jobLength" text,
  "fenceHeight" text,
  "materialsBreakdown" jsonb default '[]'::jsonb,
  "acceptedAt" text,
  "acceptedByName" text,
  inserted_at timestamptz not null default now()
);

create table if not exists invoices (
  id text primary key,
  "docNumber" text,
  "clientName" text,
  "address" text,
  "suburb" text,
  "jobType" text,
  "items" jsonb default '[]'::jsonb,
  "status" text,
  "issuedDate" text,
  "dueDate" text,
  "paidDate" text,
  "notes" text,
  "quoteId" text,
  inserted_at timestamptz not null default now()
);

create table if not exists materials (
  id text primary key,
  "name" text,
  "unit" text,
  "costPerUnit" text,
  "packQty" text,
  "qtyOnHand" text,
  "reorderLevel" text,
  "supplier" text,
  inserted_at timestamptz not null default now()
);

create table if not exists expenses (
  id text primary key,
  "description" text,
  "category" text,
  "amount" text,
  "date" text,
  inserted_at timestamptz not null default now()
);

-- Single-row table (id = '1').
create table if not exists settings (
  id text primary key,
  "consumption" text,
  "fuelPrice" text,
  "hourlyRate" text,
  "tipRatePerMetre" text,
  "nextDocNumber" text,
  inserted_at timestamptz not null default now()
);

-- Row Level Security is ON with no policies on every table — this is a deliberate
-- default-deny lockout. Nobody can read or write these tables through the public
-- REST API using the anon key; the app talks to Postgres exclusively through its
-- own server-side API routes (see lib/supabaseAdmin.js), authenticated with the
-- service_role key, which bypasses RLS by design. See supabase/migration-3-enable-rls.sql
-- for the history of why this changed from an earlier RLS-off setup.
alter table leads enable row level security;
alter table quotes enable row level security;
alter table invoices enable row level security;
alter table materials enable row level security;
alter table expenses enable row level security;
alter table settings enable row level security;
