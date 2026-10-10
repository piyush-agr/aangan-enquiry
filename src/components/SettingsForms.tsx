"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

function useSubmit(url: string, ok: string) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(body: unknown) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? { ok: true, text: ok } : { ok: false, text: j.error ?? (res.status === 403 ? "Only admins can change this." : res.statusText) });
    if (res.ok) router.refresh();
  }
  return { msg, busy, submit };
}

export function RateForm() {
  const { msg, busy, submit } = useSubmit("/api/settings/rates", "Rate saved. New calls will be costed with it.");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({ provider: f.get("provider"), category: f.get("category"), unit: f.get("unit"), rate: Number(f.get("rate")), currency: "INR", source: f.get("source") });
      }}
    >
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div> : null}
      <div className="filters">
        <label className="f">Provider<input name="provider" defaultValue="vaaniyantra" required pattern="[a-z0-9_-]{2,40}" /></label>
        <label className="f">What it covers<select name="category"><option value="voice_minute">Voice agent minutes</option><option value="telephony_minute">Phone-line minutes (Twilio, Exotel…)</option></select></label>
        <label className="f">Billed per<select name="unit"><option value="minute">minute, pro-rated</option><option value="minute_rounded_up">started minute</option></select></label>
        <label className="f">Rate (₹)<input name="rate" type="number" step="0.0001" min="0.0001" required /></label>
      </div>
      <label className="f">Where this rate comes from<input name="source" required minLength={5} placeholder="e.g. VaaniYantra Settings → Billing, checked 10 Oct 2026" /></label>
      <div><button className="btn" disabled={busy}>Save rate</button></div>
    </form>
  );
}

export function ActualCostForm() {
  const { msg, busy, submit } = useSubmit("/api/settings/actual-cost", "Invoice recorded as an actual cost.");
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void submit({ provider: f.get("provider"), amount: Number(f.get("amount")), currency: "INR", periodEnd: f.get("periodEnd"), note: f.get("note") });
      }}
    >
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div> : null}
      <div className="filters">
        <label className="f">Provider<input name="provider" defaultValue="vaaniyantra" required pattern="[a-z0-9_-]{2,40}" /></label>
        <label className="f">Amount (₹)<input name="amount" type="number" step="0.01" min="0" required /></label>
        <label className="f">Period ending<input name="periodEnd" type="date" required /></label>
        <label className="f">Invoice reference<input name="note" required minLength={3} placeholder="e.g. Invoice INV-0042, Sept 2026" /></label>
      </div>
      <div><button className="btn ghost" disabled={busy}>Record invoice</button></div>
    </form>
  );
}

export function ClearDemoButton({ count }: { count: number }) {
  const { msg, busy, submit } = useSubmit("/api/demo/clear", "Demo records deleted.");
  return (
    <div>
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div> : null}
      <button
        className="btn danger"
        disabled={busy || count === 0}
        onClick={() => {
          if (confirm(`Delete all ${count} demo enquiries and their demo events and costs? Real enquiries are not affected. This can't be undone.`)) void submit({ confirm: "DELETE DEMO DATA" });
        }}
      >
        Delete {count} demo records
      </button>
    </div>
  );
}

export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div>
      <button className="btn ghost" type="button" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); }}>{done ? "Copied" : `Copy ${label}`}</button>
      <pre className="msg" style={{ maxHeight: 260, overflow: "auto", maxWidth: "100%" }}>{text}</pre>
    </div>
  );
}
