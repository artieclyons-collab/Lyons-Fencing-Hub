// What to do with a work order (see lib/workOrder.js): the quote it names is Accepted (if it's still Sent or Draft), the client's lead is Won, the lead
// keeps where to go and who to call, and the phone buzzes so you can book a day. Server only. -> { docNumber, client } | null
import { quotesForLead } from "./quoteDecision";
import { sendPush } from "./push";

const brisbane = (opts) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", ...opts }).format(new Date());

export async function applyWorkOrder(db, wo, { display = "" } = {}) {
  const { data: rows } = await db.from("quotes").select("*").eq("docNumber", wo.quoteNo).limit(1);
  const quote = rows?.[0];
  const who = quote?.clientName || display || "A property manager";
  const day = brisbane({ day: "numeric", month: "short" });

  if (quote && ["Sent", "Draft"].includes(quote.status)) {
    await db.from("quotes").update({ status: "Accepted", acceptedAt: brisbane({ year: "numeric", month: "2-digit", day: "2-digit" }), acceptedByName: `${display || "Property manager"} (work order${wo.ref ? ` #${wo.ref}` : ""})` }).eq("id", quote.id);
  }
  const line = `Work order${wo.ref ? ` #${wo.ref}` : ""} (${day}): ${[wo.summary, wo.details].filter(Boolean).join(". ")}${wo.access ? `. Access: ${wo.access}` : ""}${wo.due ? `. Due ${wo.due}` : ""}.`;
  if (quote) {
    const { data: leads } = await db.from("leads").select("id,name,phone,email,status,notes");
    const lead = (leads || []).find((l) => quotesForLead([quote], l).length > 0);
    if (lead && !String(lead.notes || "").includes(`Work order${wo.ref ? ` #${wo.ref}` : ""} (`)) {
      await db.from("leads").update({ status: ["New", "Contacted", "Quoted"].includes(lead.status) ? "Won" : lead.status, notes: [String(lead.notes || "").trim(), line].filter(Boolean).join("\n").slice(-4000) }).eq("id", lead.id);
    }
  }
  await sendPush(db, { title: `Work order: ${who}${quote ? ` (${quote.docNumber})` : ""}`, body: `${quote ? `${wo.quoteNo} approved. ` : "No matching quote found. "}${wo.address || ""}${wo.access ? `. Access: ${wo.access}` : ""}. It needs a start date.`.slice(0, 160), tag: `workorder-${wo.ref || wo.quoteNo}`, url: "/?tab=quotes" });
  return { docNumber: wo.quoteNo, client: who };
}
