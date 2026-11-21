// A client texts their email address ("my email is sandra@gmail.com, can you send the quote there"): keep it on their lead and on any of their
// quotes / unpaid invoices that don't have one yet, so "Email quote" just works. (Server side saving here; findEmail itself is pure.)
import { quotesForLead } from "./quoteDecision";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const valid = (s) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(s || "").trim());
export const hasEmail = (s) => valid(s);

// -> the first email address in the text that isn't the business's own (lower-cased), or "".
export function findEmail(text, ownAddresses = []) {
  const own = new Set([...ownAddresses, process.env.GMAIL_USER].filter(Boolean).map((s) => String(s).toLowerCase()));
  for (const m of String(text || "").match(EMAIL) || []) {
    const e = m.replace(/[.,;:!?]+$/, "").toLowerCase();
    if (valid(e) && !own.has(e) && !/^(?:no-?reply|noreply|donotreply)@/.test(e)) return e;
  }
  return "";
}

// Put the address on this lead's quotes (Draft, Sent or Accepted) and their unpaid invoices that have none. -> how many documents were filled in.
export async function shareEmail(supabase, lead, email) {
  if (!email) return 0;
  const { data: quotes } = await supabase.from("quotes").select("id,clientName,clientPhone,clientEmail,status");
  const mine = quotesForLead(quotes || [], lead).filter((q) => !valid(q.clientEmail) && ["Draft", "Sent", "Accepted"].includes(q.status));
  let n = 0;
  for (const q of mine) {
    const { error } = await supabase.from("quotes").update({ clientEmail: email }).eq("id", q.id);
    if (!error) n++;
  }
  const ids = new Set(quotesForLead(quotes || [], lead).map((q) => q.id));
  if (ids.size) {
    const { data: invs } = await supabase.from("invoices").select("id,quoteId,clientEmail,status");
    for (const i of (invs || []).filter((i) => ids.has(i.quoteId) && !valid(i.clientEmail) && i.status !== "Paid")) {
      const { error } = await supabase.from("invoices").update({ clientEmail: email }).eq("id", i.id);
      if (!error) n++;
    }
  }
  return n;
}
