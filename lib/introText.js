// The first text to a new lead ("Hey Des, it's Artie from Lyons Fencing & Services. I saw your post on Hipages…").
// It's a draft that opens in Messages from Artie's own number, ready to edit before sending — never sent automatically,
// because the job isn't always clear from the lead (timber or Colorbond?).

export const INTRO_TEXTS = {
  intro:
    "Hey {name},\n\nIt’s Artie from Lyons Fencing & Services. I saw your post on Hipages and would be happy to provide you with a free quote for your {job}.\n\nI could come out to measure and quote in-person or if you’ve got some more photos and details I should be able to email through a quote estimate.\n\nThanks\nArtie",
  introOther:
    "Hey {name},\n\nIt’s Artie from Lyons Fencing & Services. Thanks for getting in touch, I’d be happy to provide you with a free quote for your {job}.\n\nI could come out to measure and quote in-person or if you’ve got some more photos and details I should be able to email through a quote estimate.\n\nThanks\nArtie",
};

// What the job is called in the text, in the order they're offered on the screen.
export const JOB_PHRASES = ["Colorbond fence installation", "timber fence installation", "fence installation", "gate installation", "retaining wall", "fence repairs"];

// The best guess at the job from the lead (its type, and failing that the words the client used). When it can't tell
// timber from Colorbond it says plain "fence installation", and the screen lets Artie pick before sending.
export function jobPhrase(lead) {
  const type = String(lead?.jobType || "");
  if (/colou?rbond/i.test(type)) return JOB_PHRASES[0];
  if (/timber/i.test(type)) return JOB_PHRASES[1];
  if (/retaining/i.test(type)) return JOB_PHRASES[4];
  if (/gate/i.test(type)) return JOB_PHRASES[3];
  if (/repair/i.test(type)) return JOB_PHRASES[5];
  const words = `${lead?.notes || ""}`.slice(0, 600);
  const colorbond = /colou?rbond|steel/i.test(words);
  const timber = /timber|wooden|paling|pine|lapped/i.test(words);
  if (colorbond && !timber) return JOB_PHRASES[0];
  if (timber && !colorbond) return JOB_PHRASES[1];
  return JOB_PHRASES[2];
}

export const firstName = (name) => {
  const n = String(name || "").replace(/\(.*?\)/g, "").trim().split(/\s+/)[0] || "";
  return /^(n\/?a|lead|client|enquiry|unknown|customer)$/i.test(n) ? "" : n;
};

// Which wording applies, filled in for this lead. `texts` is the saved wording (see Texts to send → Edit wording).
export function introDraft(lead, texts = INTRO_TEXTS, job = jobPhrase(lead)) {
  const tpl = lead?.source === "hipages" ? texts.intro || INTRO_TEXTS.intro : texts.introOther || INTRO_TEXTS.introOther;
  return String(tpl)
    .replace(/\{name\}/g, firstName(lead?.name))
    .replace(/\{job\}/g, job)
    .replace(/^Hey ,/, "Hey,");
}

export const smsLink = (phone, body) => {
  const sep = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent) ? "&" : "?";
  return `sms:${String(phone).replace(/[^\d+]/g, "")}${sep}body=${encodeURIComponent(body)}`;
};

// A lead that's waiting for its first message: new, with a phone number to text.
export const needsIntro = (lead) => lead?.status === "New" && String(lead.phone || "").replace(/\D/g, "").length >= 8;
