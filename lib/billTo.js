// "Bill to": who the quote and invoice are made out to when that isn't the person you deal with (a body corporate, a company, a strata
// manager). The contact stays "Jessie" for texts and emails; the quote and invoice say "Gooding Drive Villas CTS 38702".
// It's kept as one line in the lead's notes ("Bill to: …") so every quote made from the lead gets it, then as billName on the quote and
// on the invoices made from it. A client's email or text asking for it ("can you put X in the invoice", "please amend the invoice to: X")
// sets it automatically.
export const BILL_TO_LINE = /^\s*bill(?:ed)?\s+to\s*:\s*(.+?)\s*$/i;

export function getBillTo(notes) {
  for (const l of String(notes || "").split("\n")) {
    const m = BILL_TO_LINE.exec(l);
    if (m) return m[1];
  }
  return "";
}

export function setBillTo(notes, name) {
  const lines = String(notes || "").split("\n").filter((l) => !BILL_TO_LINE.test(l));
  if (name) lines.push(`Bill to: ${name}`);
  return lines.join("\n").replace(/^\n+/, "");
}

const clean = (s) => String(s || "").replace(/[\s"'`]+$/g, "").replace(/^[\s"'`:]+/, "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();

// -> the name asked for, or "". Matches things like:
//   "Can you pls put Gooding Drive Villas CTS 38702 in the invoice. It's required by Body Corporate."
//   "Can you please amend the invoice to: Gooding Drive Villas CTS 38702, and resend it back to me."
//   "Please make the invoice out to Smith Strata Management"
export function detectBillTo(text) {
  const t = String(text || "").replace(/[’‘ʼ]/g, "'").replace(/\s*\n\s*/g, " ");
  const tries = [
    /\b(?:put|use|add|include|write)\s+(.{3,80}?)\s+(?:in|on|as)\s+(?:the\s+|this\s+|my\s+|our\s+)?(?:invoices?|quotes?|bills?|account|name)\b/i,
    /\b(?:amend|change|update|correct|reissue|re-issue|redo|alter|make)\s+(?:the\s+|this\s+|my\s+|our\s+)?(?:invoices?|quotes?)\s+(?:(?:out\s+)?to|so\s+it\s+says|so\s+that\s+it\s+says)\s*:?\s*(.{3,80}?)(?=[.;,\n]|\s+(?:and|as|please|thanks|thank|because|it's|its|since)\b|$)/i,
    /\b(?:invoices?|quotes?)\s+(?:needs?\s+to\s+be\s+|should\s+be\s+|to\s+be\s+|must\s+be\s+)?(?:made\s+out|addressed|billed)\s+to\s*:?\s*(.{3,80}?)(?=[.;,\n]|\s+(?:and|as|please|thanks|thank|because|it's|its|since)\b|$)/i,
  ];
  for (const re of tries) {
    const m = re.exec(t);
    if (!m) continue;
    const name = clean(m[1]);
    // needs to look like a name (letters), not "the details", "it", "another number"
    if (name.length >= 4 && /[A-Za-z]{3}/.test(name) && !/^(?:the|it|this|that|a|an|my|our|your|them|him|her|one|number|details?|name|address)\b/i.test(name)) return name.slice(0, 80);
  }
  return "";
}

// Is this message talking about someone else's household, so an address in it isn't the client's own?
//   "the neighbours next door to us, 21 Wedgebill Parade, are Mick and Fiona", "invoice her portion directly to her at the below address"
export const mentionsOtherHousehold = (text) =>
  /\bneighbou?rs?\b|\bnext[\s-]door\b|\b(?:her|his|their)\s+(?:portion|half|share)\b|\binvoic(?:e|ed)\s+(?:directly\s+)?to\s+(?:her|him|them)\b/i.test(String(text || ""));
