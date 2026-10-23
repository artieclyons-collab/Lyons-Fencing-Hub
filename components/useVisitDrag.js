"use client";
// Drag a visit in the Visit planner: hold the grip beside it and move it up or down to change the order of the day (the times
// re-work themselves), or drop it onto one of the day chips that appear at the top to move it to that day.
// Uses pointer events so it works with a finger as well as a mouse (HTML5 drag-and-drop doesn't on phones).
import { useState, useRef, useEffect, useCallback } from "react";

// onReorder(date, orderedIds), onDropOnDay(id, date)
export function useVisitDrag({ onReorder, onDropOnDay }) {
  const [drag, setDrag] = useState(null); // { id, date, index, overDay }
  const listRef = useRef(null); // the container holding the day's visit cards ([data-stop-id])
  const st = useRef(null); // { id, date, order, y }
  const handlers = useRef({ onReorder, onDropOnDay });
  handlers.current = { onReorder, onDropOnDay };

  const measure = (clientX, clientY, id) => {
    const cards = [...(listRef.current?.querySelectorAll("[data-stop-id]") || [])].filter((c) => c.dataset.stopId !== id);
    let index = 0;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (clientY > r.top + r.height / 2) index++;
    }
    const el = document.elementFromPoint(clientX, clientY);
    const overDay = el?.closest?.("[data-drop-day]")?.dataset.dropDay || null;
    return { index, overDay };
  };

  const onPointerDown = useCallback((e, id, date, order) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* an input without capture: the drag still works while the pointer stays over the grip */ }
    st.current = { id, date, order, y: e.clientY };
    setDrag({ id, date, index: order.indexOf(id), overDay: null });
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!st.current) return;
    st.current.y = e.clientY;
    const m = measure(e.clientX, e.clientY, st.current.id);
    setDrag((d) => (d && (d.index !== m.index || d.overDay !== m.overDay) ? { ...d, ...m } : d));
  }, []);

  const finish = useCallback((e, cancelled) => {
    const cur = st.current;
    st.current = null;
    if (!cur) return;
    const m = cancelled ? { index: -1, overDay: null } : measure(e.clientX, e.clientY, cur.id);
    setDrag(null);
    if (cancelled) return;
    if (m.overDay) {
      handlers.current.onDropOnDay(cur.id, m.overDay);
    } else if (m.index !== cur.order.indexOf(cur.id)) {
      const rest = cur.order.filter((x) => x !== cur.id);
      rest.splice(m.index, 0, cur.id);
      handlers.current.onReorder(cur.date, rest);
    }
  }, []);

  // While dragging near the top or bottom edge of the screen, scroll the page so the rest of the day is reachable.
  useEffect(() => {
    if (!drag) return undefined;
    const timer = setInterval(() => {
      const y = st.current?.y;
      if (y == null) return;
      if (y < 130) window.scrollBy(0, -14);
      else if (y > window.innerHeight - 90) window.scrollBy(0, 14);
    }, 30);
    return () => clearInterval(timer);
  }, [drag?.id]);

  const gripProps = (id, date, order) => ({
    onPointerDown: (e) => onPointerDown(e, id, date, order),
    onPointerMove,
    onPointerUp: (e) => finish(e, false),
    onPointerCancel: (e) => finish(e, true),
    style: { touchAction: "none", cursor: "grab", userSelect: "none", WebkitUserSelect: "none" },
  });

  return { drag, listRef, gripProps };
}
