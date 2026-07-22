-- Supabase enables Row Level Security by default on new tables, which blocks
-- the anon key from reading/writing. Per the build brief this is a single-user
-- tool with no login screen, so RLS stays off (the anon URL + key are the
-- access control — don't share them publicly). Run this once after schema.sql.
alter table leads disable row level security;
alter table quotes disable row level security;
alter table invoices disable row level security;
alter table materials disable row level security;
alter table expenses disable row level security;
alter table settings disable row level security;
