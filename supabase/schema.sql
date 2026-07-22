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

-- Single-user tool with no auth (per the build brief): RLS stays off, access is
-- gated by keeping the app URL + anon key private. If you ever add Supabase Auth,
-- enable RLS on all six tables and add authenticated-only policies.
-- Supabase enables RLS by default on new tables — turn it back off explicitly.
alter table leads disable row level security;
alter table quotes disable row level security;
alter table invoices disable row level security;
alter table materials disable row level security;
alter table expenses disable row level security;
alter table settings disable row level security;
