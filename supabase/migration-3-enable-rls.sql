-- Run once in the Supabase SQL Editor.
--
-- Turns Row Level Security back ON, with no policies attached — a
-- default-deny lockout. Earlier setup (disable-rls.sql) turned it off so
-- the app could read/write using the public anon key directly from the
-- browser. That anon key isn't actually secret once the site is public
-- (anyone can read it from the deployed page), so RLS-off + anon key meant
-- anyone could read, edit, or delete every row in every table.
--
-- Before running this: the app must already be deployed with the
-- server-side /api/data and /api/accept routes (using SUPABASE_SERVICE_ROLE_KEY),
-- otherwise the app will stop being able to load or save anything the
-- moment this runs. Deploy the code first, confirm it works, then run this.
alter table leads enable row level security;
alter table quotes enable row level security;
alter table invoices enable row level security;
alter table materials enable row level security;
alter table expenses enable row level security;
alter table settings enable row level security;
