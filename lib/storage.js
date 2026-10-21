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
//
// Two things keep the schedule trustworthy when the hub is used from more than one place:
//   - Saves run strictly one after another, each working from the latest state, so a quick run of
//     changes can never land out of order and leave an older value in the database.
//   - While the hub is open it quietly re-reads the database when you come back to it (and every
//     minute), so a change made on the laptop shows up on the phone instead of being overwritten later
//     by a stale screen. It never replaces anything that hasn't finished saving.
import { useState, useEffect, useRef, useCallback } from "react";
import { sanitizeRow } from "./tableSchema";

export const usingSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

const REFRESH_MS = 60000;

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

// Lets the UI show a banner when a save fails (otherwise the screen looks saved while the database isn't).
const reportSave = (ok, table, message, skipped = []) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("hub-save", { detail: { ok, table, message, skipped } }));
};

async function apiGet(table) {
  const res = await fetch(`/api/data/${table}`, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Failed to load ${table}`);
  return body.rows || [];
}
async function apiUpsert(table, rows) {
  const payload = JSON.stringify({ rows });
  const res = await fetch(`/api/data/${table}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: payload.length < 60000, // lets the save finish even if the page/app is closed right after
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Failed to save ${table}`);
  return body.skippedColumns || [];
}
async function apiDelete(table, ids) {
  const res = await fetch(`/api/data/${table}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
    keepalive: true,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed to delete from ${table}`);
}

// Calls `fn` when the app comes back into view, the network returns, and every minute while it's visible.
function useRefreshTriggers(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!usingSupabase) return undefined;
    const wake = () => { if (!document.hidden) ref.current(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    const timer = setInterval(wake, REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      clearInterval(timer);
    };
  }, []);
}

// ---------- list hook ----------
export function usePersistedList(key) {
  const table = key.split(":").pop();
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  // Anything removed by the person using the app (not a refresh from the database) is announced, so the app can offer Undo.
  const localEdit = useRef(false);
  const prevItems = useRef([]);
  const setItemsByUser = useCallback((updater) => {
    localEdit.current = true;
    setItems(updater);
  }, []);
  useEffect(() => {
    const before = prevItems.current;
    prevItems.current = items;
    if (!localEdit.current) return;
    localEdit.current = false;
    const now = new Set(items.map((r) => r?.id));
    const removed = before.filter((r) => r?.id && !now.has(r.id));
    if (removed.length > 0 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("hub-deleted", { detail: { table, rows: removed } }));
  }, [items]);
  const lastSynced = useRef(new Map()); // id -> serialized sanitized row, as last confirmed in the database
  const itemsRef = useRef([]);          // latest items, read when a queued save actually runs
  const queue = useRef(Promise.resolve());
  const busy = useRef(0);               // saves queued or running
  itemsRef.current = items;

  // What differs between the screen and the database right now.
  const diff = (list) => {
    const nextIds = new Set();
    const upserts = [];
    for (const row of list) {
      if (!row || !row.id) continue;
      nextIds.add(row.id);
      const clean = sanitizeRow(table, row);
      if (lastSynced.current.get(row.id) !== JSON.stringify(clean)) upserts.push(clean);
    }
    const deletions = [...lastSynced.current.keys()].filter((id) => !nextIds.has(id));
    return { upserts, deletions };
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (usingSupabase) {
        try {
          const rows = await apiGet(table);
          if (cancelled) return;
          lastSynced.current = new Map(rows.map((r) => [r.id, JSON.stringify(sanitizeRow(table, r))]));
          localEdit.current = false;
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

  // Save: queue a run that works from the *latest* state when its turn comes, so saves never overtake each other.
  // If a save fails (a dropped connection, say) it's retried a few seconds later, then again, before giving up.
  const attempts = useRef(0);
  const retryTimer = useRef(null);
  const queueSave = () => {
    busy.current++;
    queue.current = queue.current.then(async () => {
      try {
        const { upserts, deletions } = diff(itemsRef.current);
        if (upserts.length === 0 && deletions.length === 0) return;
        let skipped = [];
        if (upserts.length > 0) {
          skipped = await apiUpsert(table, upserts);
          for (const r of upserts) lastSynced.current.set(r.id, JSON.stringify(r));
        }
        if (deletions.length > 0) {
          await apiDelete(table, deletions);
          for (const id of deletions) lastSynced.current.delete(id);
        }
        attempts.current = 0;
        reportSave(true, table, undefined, skipped);
      } catch (e) {
        console.error(`Failed to save ${table}`, e);
        reportSave(false, table, e.message);
        if (attempts.current < 5) {
          attempts.current++;
          clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(queueSave, 4000 * attempts.current);
        }
      } finally {
        busy.current--;
      }
    });
  };

  useEffect(() => {
    if (!loaded) return;
    if (!usingSupabase) {
      lsSet(key, items);
      return;
    }
    const d = diff(items);
    if (d.upserts.length === 0 && d.deletions.length === 0) return;
    attempts.current = 0;
    clearTimeout(retryTimer.current);
    queueSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loaded]);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  // Pick up changes made elsewhere (another tab, the phone, the laptop) — but never over unsaved work.
  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  useRefreshTriggers(async () => {
    if (!loadedRef.current || busy.current > 0) return;
    const local = diff(itemsRef.current);
    if (local.upserts.length > 0 || local.deletions.length > 0) {
      queueSave(); // something here hasn't saved yet — try again rather than replace it
      return;
    }
    try {
      const rows = await apiGet(table);
      if (busy.current > 0) return; // a save started while we were fetching
      const fresh = new Map(rows.map((r) => [r.id, JSON.stringify(sanitizeRow(table, r))]));
      const unchanged = fresh.size === lastSynced.current.size && [...fresh].every(([id, s]) => lastSynced.current.get(id) === s);
      if (unchanged) return;
      lastSynced.current = fresh;
      localEdit.current = false;
      setItems(rows);
    } catch {
      // offline or a blip — try again at the next trigger
    }
  });

  return [items, setItemsByUser, loaded];
}

// ---------- single-value hook (settings) ----------
export function usePersistedValue(key, fallback) {
  const table = key.split(":").pop();
  const [value, setValue] = useState(fallback);
  const [loaded, setLoaded] = useState(false);
  const lastSynced = useRef(null); // serialized value as last confirmed in the database
  const valueRef = useRef(fallback);
  const queue = useRef(Promise.resolve());
  const busy = useRef(0);
  const attempts = useRef(0);
  const retryTimer = useRef(null);
  valueRef.current = value;

  const serialize = (v) => JSON.stringify(sanitizeRow(table, { ...v, id: "1" }));

  // Same idea as the list hook: queued, in order, retried a few times if it fails.
  const queueSave = () => {
    busy.current++;
    queue.current = queue.current.then(async () => {
      try {
        const row = sanitizeRow(table, { ...valueRef.current, id: "1" });
        if (JSON.stringify(row) === lastSynced.current) return;
        await apiUpsert(table, [row]);
        lastSynced.current = JSON.stringify(row);
        attempts.current = 0;
        reportSave(true, table);
      } catch (e) {
        console.error(`Failed to save ${table}`, e);
        reportSave(false, table, e.message);
        if (attempts.current < 5) {
          attempts.current++;
          clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(queueSave, 4000 * attempts.current);
        }
      } finally {
        busy.current--;
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (usingSupabase) {
        try {
          const rows = await apiGet(table);
          if (cancelled) return;
          if (rows.length > 0) {
            const { id, inserted_at, ...rest } = rows[0];
            const next = { ...fallback, ...rest };
            lastSynced.current = serialize(next);
            setValue(next);
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
    if (serialize(value) === lastSynced.current) return; // nothing new to save (e.g. just loaded)
    attempts.current = 0;
    clearTimeout(retryTimer.current);
    queueSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, loaded]);
  useEffect(() => () => clearTimeout(retryTimer.current), []);

  const loadedRef = useRef(false);
  loadedRef.current = loaded;
  useRefreshTriggers(async () => {
    if (!loadedRef.current || busy.current > 0) return;
    if (serialize(valueRef.current) !== lastSynced.current) {
      queueSave(); // unsaved change here — try again rather than replace it
      return;
    }
    try {
      const rows = await apiGet(table);
      if (busy.current > 0 || rows.length === 0) return;
      const { id, inserted_at, ...rest } = rows[0];
      const next = { ...fallback, ...rest };
      if (serialize(next) === lastSynced.current) return;
      lastSynced.current = serialize(next);
      setValue(next);
    } catch {
      // try again at the next trigger
    }
  });

  return [value, setValue, loaded];
}
