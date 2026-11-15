"use client";
// Board card: the Monday brief the hub wrote this week (see lib/brief.js). Shown until the end of the week, and can be put away.
import { useEffect, useMemo, useState } from "react";
import { Newspaper, X } from "lucide-react";
import { today } from "@/lib/logic";

const KEY = "lyons:brief-hidden";

export default function MondayBrief({ expenses = [] }) {
  const brief = useMemo(() => {
    const row = expenses.find((e) => e.id === "sys-brief");
    try { const b = JSON.parse(row?.description || "null"); return b?.text && b.day ? b : null; } catch { return null; }
  }, [expenses]);
  const [hidden, setHidden] = useState("");
  useEffect(() => { try { setHidden(window.localStorage.getItem(KEY) || ""); } catch {} }, []);
  if (!brief || hidden === brief.day) return null;
  const age = Math.round((Date.parse(today()) - Date.parse(brief.day)) / 86400000);
  if (age > 6) return null;
  const label = new Date(`${brief.day}T00:00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="panel">
      <div className="panel-head">
        <Newspaper size={16} /><span>Your Monday brief · {label}</span>
        <button className="icon-btn" style={{ marginLeft: "auto" }} aria-label="Put away" title="Put away" onClick={() => { setHidden(brief.day); try { window.localStorage.setItem(KEY, brief.day); } catch {} }}><X size={15} /></button>
      </div>
      <div style={{ whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.5 }}>{brief.text}</div>
    </div>
  );
}
