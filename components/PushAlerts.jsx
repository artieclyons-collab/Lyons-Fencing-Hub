"use client";
// Phone alerts (web push) switch on the Board. On an iPhone the hub has to be added to the Home Screen first (Share, Add to Home Screen)
// and opened from that icon; then this turns alerts on for that phone. See lib/push.js for what gets sent.
import { useEffect, useState } from "react";
import { Smartphone, Check } from "lucide-react";

const keyBytes = (b64) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export default function PushAlerts() {
  const [state, setState] = useState("checking"); // checking | needsInstall | unsupported | notConfigured | off | on | blocked
  const [publicKey, setPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "needsInstall" : "unsupported");
        return;
      }
      const r = await fetch("/api/push/subscribe", { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
      if (!r.configured) { setState("notConfigured"); return; }
      setPublicKey(r.publicKey);
      if (Notification.permission === "denied") { setState("blocked"); return; }
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })();
  }, []);

  const turnOn = async () => {
    setBusy(true); setMsg("");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState("blocked"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "couldn't save this phone");
      setState("on");
      await fetch("/api/push/test", { method: "POST" });
      setMsg("Turned on. A test alert is on its way.");
    } catch (e) {
      setMsg(`Couldn't turn alerts on: ${e.message || "try again"}.`);
    } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setMsg("");
    const r = await fetch("/api/push/test", { method: "POST" }).then((x) => x.json()).catch(() => ({}));
    setMsg(r.sent > 0 ? "Test sent." : "Nothing was sent, so this phone isn't signed up. Turn alerts off and on again.");
    setBusy(false);
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) { await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); }
      setState("off");
    } finally { setBusy(false); }
  };

  const text = {
    checking: "",
    needsInstall: "To get alerts on an iPhone, add the hub to your Home Screen first (Safari, Share, Add to Home Screen), then open it from that icon and come back here.",
    unsupported: "This browser can't do phone alerts.",
    notConfigured: "Phone alerts aren't switched on for the hub yet (the alert keys still need adding on the server).",
    blocked: "Alerts are blocked for the hub on this phone. Allow notifications for it in the phone's settings.",
    off: "Get an alert on this phone the moment a new hipages lead or enquiry comes in, and a reminder if you haven't replied.",
    on: "On for this phone. You'll get an alert for a new lead, and a reminder every half hour until you reply.",
  }[state];
  if (state === "checking") return null;

  return (
    <div className="panel">
      <div className="panel-head"><Smartphone size={16} /><span>Phone alerts</span></div>
      <p className="calc-note" style={{ margin: 0 }}>{text}</p>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        {state === "off" && <button className="btn-primary small" onClick={turnOn} disabled={busy}>Turn on alerts</button>}
        {state === "on" && <><button className="btn-ghost small" onClick={test} disabled={busy}><Check size={13} /> Send a test</button><button className="btn-ghost small" onClick={turnOff} disabled={busy}>Turn off</button></>}
      </div>
      {msg && <p className="calc-note" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
