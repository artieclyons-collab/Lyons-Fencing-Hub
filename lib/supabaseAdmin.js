// Server-only Supabase client using the service_role key — bypasses RLS.
// NEVER import this from a "use client" component. Only API route handlers
// (which run exclusively on the server) should touch this file. The
// service_role key must never be sent to, or read by, the browser.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin =
  SUPABASE_URL && SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
