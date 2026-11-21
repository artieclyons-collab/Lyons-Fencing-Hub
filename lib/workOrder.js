// A work order from a property manager's system (PropertyMe, Console, PropertyTree: "Work order Job #932 ... Approved Quote LFS467 ... Access contact ...").
// It is an approval of a quote you sent, plus where to go and who to call, so it must not be dropped as an automated email just because it has an
// unsubscribe link. Pure functions; the route (app/api/leads/inbox) marks the quote Accepted, keeps the access details and buzzes the phone.
const LABELS = ["Address", "Due date(?: \\(if set\\))?", "Access contact", "Job summary", "Job details", "Can you please", "Please do not hesitate", "Kind regards"];

export const isWorkOrder = ({ subject = "", text = "" }) => /\bwork\s*order\b/i.test(subject) || /\bwork\s*order\b/i.test(String(text).slice(0, 600));

function field(text, label) {
  const others = LABELS.filter((l) => l !== label).join("|");
  const re = new RegExp(`(?:^|[\\n|\\s])${label}\\s*\\|?\\s*([\\s\\S]*?)\\s*(?:\\||\\n|\\s)(?=(?:${others})\\b|\\n\\n|$)`, "i");
  const m = re.exec(String(text).replace(/\r/g, ""));
  return m ? m[1].replace(/\s+/g, " ").replace(/[\s|]+$/g, "").trim() : "";
}

// -> null (not a work order we can use) | { ref, quoteNo, address, due, access, summary, details }
export function parseWorkOrder({ subject = "", text = "" }) {
  if (!isWorkOrder({ subject, text })) return null;
  const body = String(text);
  const quote = /\bapproved\s+quote\s+(LFS)\s*-?\s*(\d+)/i.exec(body) || /\bquote\s+(LFS)\s*-?\s*(\d+)\b/i.exec(`${subject} ${body}`);
  const ref = /\bjob\s*#?\s*(\d+)/i.exec(subject || body)?.[1] || "";
  const out = {
    ref,
    quoteNo: quote ? `LFS${quote[2]}` : "",
    address: field(body, "Address"),
    due: field(body, "Due date(?: \\(if set\\))?"),
    access: field(body, "Access contact"),
    summary: field(body, "Job summary"),
    details: field(body, "Job details"),
  };
  return out.quoteNo || out.address ? out : null;
}
