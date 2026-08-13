"use client";
// Drop-in replacements for the artifact's window.storage hooks.
// Same signatures (usePersistedList / usePersistedValue) so components are
// unchanged; underneath, every read/write goes through this app's own
// /api/data/[table] route (server-side, using the service_role key) rather
// than talking to Supabase directly from the browser. That way the browser
// never holds a working database credential — Row Level Security blocks the
// old anon key entirely, so a leaked key (e.g. via dev tools) grants nothing.
// If the backend isn't configured (e.g. very first local run), falls back
// to localStorage so the app still works — a banner in the UI shows which
// mode is active.
import { useState, useEffect, useRef } from "react";
import { sanitizeRow } from "./tableSchema";

export const usingSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

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

async function apiGet(table) {
  const res = await fetch(`/api/data/${table}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Failed to load ${table}`);
  return body.rows || [];
}
async function apiUpsert(table, rows) {
  const res = await fetch(`/api/data/${table}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to save ${table}`);
}
async function apiDelete(table, ids) {
  const res = await fetch(`/api/data/${table}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to delete from ${table}`);
}

// ---------- list hook ----------
export function usePersistedList(key) {
  const table = key.split(":").pop();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const lastSynced = useRef(new Map()); // id -> serialized sanitized row

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (usingSupabase) {
        try {
          const rows = await apiGet(table);
          if (cancelled) return;
          lastSynced.current = new Map(rows.map((r) => [r.id, JSON.stringify(sanitizeRow(table, r))]));
          setItems(rows);
        } catch (e) {
          console.error(`Failed to load ${table}`, e);
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
    if (!usingSupabase) {
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
          await apiUpsert(table, upserts);
          for (const r of upserts) lastSynced.current.set(r.id, JSON.stringify(r));
        }
        if (deletions.length > 0) {
          await apiDelete(table, deletions);
          for (const id of deletions) lastSynced.current.delete(id);
        }
      } catch (e) {
        console.error(`Failed to save ${table}`, e);
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
      if (usingSupabase) {
        try {
          const rows = await apiGet(table);
          if (cancelled) return;
          if (rows.length > 0) {
            const { id, inserted_at, ...rest } = rows[0];
            setValue({ ...fallback, ...rest });
          } else {
            setValue(fallback);
          }
        } catch (e) {
          console.error(`Failed to load ${table}`, e);
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
    if (!usingSupabase) {
      lsSet(key, value);
      return;
    }
    (async () => {
      try {
        const row = sanitizeRow(table, { ...value, id: "1" });
        await apiUpsert(table, [row]);
      } catch (e) {
        console.error(`Failed to save ${table}`, e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loaded]);

  return [value, setValue, loaded];
}
