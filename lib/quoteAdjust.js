// When the job length or fence height on a quote changes (typically on a duplicate), the rest of the quote follows:
//   - the length: lines priced per metre that were at the old length move to the new one, and the "longer or shorter than 26m" note
//   - the height: a fence line swaps to the matching template for the new height (same style, raked, lapped, sleeper),
//     with its wording and rate, and the sleeper note is added or removed
// Anything you've edited yourself (a changed rate or description, a different quantity) is left alone and mentioned.
import { JOB_TEMPLATES } from "./constants";
import { pickFence } from "./siteNotes";
import { SLEEPER_NOTE } from "./logic";

const byLabel = (label) => JOB_TEMPLATES.find((t) => t.label === label);
const isFenceLine = (it) => /fence installation/i.test(it.tpl || "");
const flagsOf = (label) => ({
  style: /colou?rbond/i.test(label) ? "colorbond" : "timber",
  raked: /^raked/i.test(label),
  lapped: /lapped/i.test(label),
  sleeper: /sleeper/i.test(label),
});
const near = (h, target) => Math.abs(h - target) < 0.06;

// form: the quote as it is now. change: { jobLength?, fenceHeight?, oldLength?, oldHeight? } — oldLength/oldHeight are the last
// real values (the field may have been cleared while typing). -> { patch, changes[], warnings[] } where patch is what to merge into the form.
export function adjustForDimensions(form, change) {
  let items = (form.items || []).map((it) => ({ ...it }));
  let notes = String(form.notes || "");
  const changes = [];
  const warnings = [];

  if (change.jobLength !== undefined) {
    const next = Number(change.jobLength) || 0;
    const prev = Number(change.oldLength) || 0;
    // The standard "…longer or shorter than 26m" sentence always follows the job length, even when the number in it was already
    // out of step (a quote copied before its notes were kept in line, or typed over by hand).
    if (next > 0) {
      const re = /(longer or shorter than )(\d+(?:\.\d+)?)m/g;
      const fixed = notes.replace(re, (m, lead, n) => (Number(n) === next ? m : `${lead}${next}m`));
      if (fixed !== notes) { notes = fixed; changes.push("the length in the notes"); }
    }
    if (next > 0 && prev > 0 && next !== prev) {
      let moved = 0;
      let kept = 0;
      items = items.map((it) => {
        if (it.unit !== "m") return it;
        if (Number(it.qty) === prev) { moved++; return { ...it, qty: next }; }
        kept++;
        return it;
      });
      if (moved) changes.push(`${moved} line${moved === 1 ? "" : "s"} per metre now ${next}m (was ${prev}m)`);
      if (kept) warnings.push(`${kept} per-metre line${kept === 1 ? " has" : "s have"} a quantity you set yourself, so I left ${kept === 1 ? "it" : "them"} alone.`);
      if (notes.includes(`${prev}m`)) {
        notes = notes.split(`${prev}m`).join(`${next}m`);
        if (!changes.includes("the length in the notes")) changes.push("the length in the notes");
      }
    }
  }

  if (change.fenceHeight !== undefined) {
    const h = Number(change.fenceHeight) || 0;
    const prevH = Number(change.oldHeight) || 0;
    const known = near(h, 1.8) || near(h, 2) || near(h, 2.1);
    if (h > 0 && h !== prevH) {
      if (!known) {
        if (h >= 1.2) warnings.push(`I don't have a fence template for ${h}m, so the lines are as they were.`);
      } else {
        items = items.map((it) => {
          if (!isFenceLine(it)) return it;
          if (/alumin/i.test(it.tpl || "")) {
            warnings.push("Aluminium slat fencing only has a 1.8m template, so that line is as it was — check the height, slat count and rate.");
            return it;
          }
          const old = byLabel(it.tpl);
          const pick = pickFence({ ...flagsOf(it.tpl), height: h });
          const t = byLabel(pick.label);
          if (pick.note) { warnings.push(`There's no ${h}m template for "${it.tpl}", so that line is as it was — check its wording and rate.`); return it; }
          if (!t || t.label === it.tpl) return it;
          // A line with a rate you changed, or a lot of extra wording of your own, isn't swapped for the template's.
          // (Older wording that's simply out of date is fine: it's refreshed to the current template's.)
          if (old && (Number(it.rate) !== Number(old.rate) || String(it.desc || "").length > old.desc.length + 80)) {
            warnings.push(`"${it.tpl}" has a rate or wording you changed, so I didn't swap it to ${t.label}.`);
            return it;
          }
          changes.push(`${it.tpl} → ${t.label}`);
          return { ...it, desc: t.desc, rate: t.rate, tpl: t.label, unit: t.unit };
        });
        const hasSleeper = items.some((it) => /sleeper/i.test(it.desc || ""));
        if (hasSleeper && !notes.includes(SLEEPER_NOTE)) {
          notes = [notes.trim(), SLEEPER_NOTE].filter(Boolean).join("\n");
          changes.push("the sleeper note added");
        } else if (!hasSleeper && notes.includes(SLEEPER_NOTE)) {
          notes = notes.split("\n").filter((l) => l.trim() !== SLEEPER_NOTE).join("\n");
          changes.push("the sleeper note removed");
        }
      }
    }
  }

  const patch = { items, notes };
  return { patch, changes, warnings };
}

// The materials list for a quote as it stands now (style from the job type, length/height from the quote, raked/lapped/gates from its lines).
export function materialsInputs(form) {
  const items = form.items || [];
  const style = /alumin/i.test(form.jobType || "") ? "aluminium" : /colou?rbond/i.test(form.jobType || "") ? "colorbond" : /timber/i.test(form.jobType || "") ? "timber" : null;
  return {
    style,
    timberStyle: items.some((it) => /lapped/i.test(it.tpl || "")) ? "lapped" : "butted",
    length: form.jobLength,
    height: form.fenceHeight || "1.8",
    slatWidth: items.some((it) => /alumin/i.test(it.tpl || "") && /90mm/i.test(it.tpl || "")) ? 90 : 65,
    gateWidth: items.some((it) => /alumin/i.test(it.tpl || "") && /1720/.test(it.tpl || "")) ? 1.7 : 1,
    raked: items.some((it) => /^raked/i.test(it.tpl || "")),
    sleeper: items.some((it) => /fence installation/i.test(it.tpl || "") && /sleeper/i.test(`${it.tpl || ""} ${it.desc || ""}`)),
    gates: items.filter((it) => /gate/i.test(it.tpl || it.desc || "") && it.unit !== "m").reduce((n, it) => n + (Number(it.qty) || 0), 0),
  };
}
