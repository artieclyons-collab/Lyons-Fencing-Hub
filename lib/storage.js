"use client";
// Drop-in replacements for the artifact's window.storage hooks.
// Same signatures (usePersistedList / usePersistedValue) so components are unchanged;
// underneath, data lives in Supabase. If Supabase env vars aren't set (e.g. first
// local run before the project exists), it falls back to localStorage so the app
// still works — a banner in the UI shows which mode is active.
import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const usingSupabase = Boolean(supabase);

// Columns per table — rows are sanitised to exactly these keys before writing,
// so stray in-memory fields (e.g. _autoPrefill) never hit the database.
export const TABLE_COLUMNS = {
  leads: ["id", "name", "phone", "email", "address", "jobType", "status", "notes", "createdAt"],
  quotes: ["id", "docNumber", "clientName", "clientPhone", "address", "suburb", "jobType", "status", "date", "startDate", "validUntil", "depositPercent", "items", "notes", "distanceKm", "crew", "hours", "removalLength", "materialsCost", "jobLength", "fenceHeight", "materialsBreakdown", "acceptedAt", "acceptedByName"],
  invoices: ["id", "docNumber", "clientName", "address", "suburb", "jobType", "items", "status", "issuedDate", "dueDate", "paidDate", "notes", "quoteId"],
  materials: ["id", "name", "unit", "costPerUnit", "packQty", "qtyOnHand", "reorderLevel", "supplier"],
  expenses: ["id", "description", "category", "amount", "date"],
  settings: ["id", "consumption", "fuelPrice", "hourlyRate", "tipRatePerMetre", "nextDocNumber"],
};

const JSONB_COLUMNS = new Set(["items", "materialsBreakdown"]);

export function sanitizeRow(table, row) {
  const cols = TABLE_COLUMNS[table] || [];
  const out = {};
  for (const c of cols) {
    let v = row[c];
    if (v === undefined) v = null;
    // Everything except id + jsonb is stored as text — coerce so PostgREST never
    // gets a type it can't cast (numbers arrive fine, but be explicit).
    if (v !== null && c !== "id" && !JSONB_COLUMNS.has(c) && typeof v !== "string") {
      if (typeof v === "number" || typeof v === "boolean") v = String(v);
    }
    out[c] = v;
  }
  return out;
}

function stripMeta(row) {
  const { inserted_at, ...rest } = row;
  return rest;
}

const lsGet = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const lsSet = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

// ---------- list hook ----------
export function usePersistedList(key) {
  const table = key.split(":").pop();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const lastSynced = useRef(new Map()); // id -> serialized sanitized row

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supabase) {
        try {
          const { data, error } = await supabase
            .from(table)
            .select("*")
            .order("inserted_at", { ascending: false });
          if (error) throw error;
          if (cancelled) return;
          const rows = (data || []).map(stripMeta);
          lastSynced.current = new Map(rows.map((r) => [r.id, JSON.stringify(sanitizeRow(table, r))]));
          setItems(rows);
        } catch (e) {
          console.error(`Failed to load ${table} from Supabase`, e);
          if (!cancelled) setItems([]);
        }
      } else {
        setItems(lsGet(key, []));
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    if (!supabase) {
      lsSet(key, items);
      return;
    }
    // Diff against the last synced state: upsert new/changed rows, delete removed ones.
    const nextIds = new Set();
    const upserts = [];
    for (const row of items) {
      if (!row || !row.id) continue;
      nextIds.add(row.id);
      const clean = sanitizeRow(table, row);
      const serialized = JSON.stringify(clean);
      if (lastSynced.current.get(row.id) !== serialized) upserts.push(clean);
    }
    const deletions = [...lastSynced.current.keys()].filter((id) => !nextIds.has(id));

    if (upserts.length === 0 && deletions.length === 0) return;

    (async () => {
      try {
        if (upserts.length > 0) {
          const { error } = await supabase.from(table).upsert(upserts);
          if (error) throw error;
          for (const r of upserts) lastSynced.current.set(r.id, JSON.stringify(r));
        }
        if (deletions.length > 0) {
          const { error } = await supabase.from(table).delete().in("id", deletions);
          if (error) throw error;
          for (const id of deletions) lastSynced.current.delete(id);
        }
      } catch (e) {
        console.error(`Failed to save ${table} to Supabase`, e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loaded]);

  return [items, setItems, loaded];
}

// ---------- single-value hook (settings) ----------
export function usePersistedValue(key, fallback) {
  const table = key.split(":").pop();
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (supabase) {
        try {
          const { data, error } = await supabase.from(table).select("*").limit(1);
          if (error) throw error;
          if (cancelled) return;
          if (data && data.length > 0) {
            const { id, inserted_at, ...rest } = data[0];
            setValue({ ...fallback, ...rest });
          } else {
            setValue(fallback);
          }
        } catch (e) {
          console.error(`Failed to load ${table} from Supabase`, e);
          if (!cancelled) setValue(fallback);
        }
      } else {
        setValue(lsGet(key, fallback));
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    if (!supabase) {
      lsSet(key, value);
      return;
    }
    (async () => {
      try {
        const row = sanitizeRow(table, { ...value, id: "1" });
        const { error } = await supabase.from(table).upsert(row);
        if (error) throw error;
      } catch (e) {
        console.error(`Failed to save ${table} to Supabase`, e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loaded]);

  return [value, setValue, loaded];
}
