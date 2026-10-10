"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  id: string;
  disposition: string;
  consultationStatus: string;
  conversionStatus: string;
  humanReviewStatus: string;
  projectValueInr: string | null;
}

/** Staff updates. Every change is audited server-side with who and when. */
export function EnquiryActions(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(body: Record<string, unknown>, label: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/enquiries/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: `${label} saved.` });
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: `Couldn't save: ${j.issues?.join(", ") ?? j.error ?? res.statusText}` });
    }
  }

  return (
    <div className="stack">
      {msg ? <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status">{msg.text}</div> : null}
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const to = String(f.get("disposition"));
          if (to === p.disposition) return;
          if ((to === "QUALIFIED" || to === "URGENT_ESCALATION") && !confirm("This will send the Telegram handoff for this enquiry. Continue?")) return;
          void save({ disposition: to, note: String(f.get("note") || "") || undefined }, "Outcome");
        }}
      >
        <label className="f">
          Outcome
          <select name="disposition" defaultValue={p.disposition}>
            <option value="QUALIFIED">Qualified (sends handoff)</option>
            <option value="NOT_QUALIFIED">Declined</option>
            <option value="HUMAN_REVIEW">Needs review</option>
            <option value="INCOMPLETE">Incomplete</option>
            <option value="URGENT_ESCALATION">Urgent (sends escalation)</option>
            <option value="MISSED">Missed</option>
          </select>
        </label>
        <label className="f">
          Reason (kept in the audit log)
          <input name="note" maxLength={500} placeholder="e.g. Nikhil approved after review" />
        </label>
        <button className="btn" disabled={busy}>Change outcome</button>
      </form>

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void save({ consultationStatus: f.get("consultationStatus") }, "Consultation");
        }}
      >
        <label className="f">
          Consultation
          <select name="consultationStatus" defaultValue={p.consultationStatus}>
            <option value="NOT_REQUESTED">Not requested</option>
            <option value="REQUESTED">Requested, not booked</option>
            <option value="BOOKED_CONFIRMED">Booked: time confirmed with caller</option>
            <option value="HELD">Consultation held</option>
          </select>
        </label>
        <button className="btn ghost" disabled={busy}>Save consultation</button>
      </form>

      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const v = String(f.get("value") || "").replace(/[, ₹]/g, "");
          const value = v ? Number(v) : null;
          if (v && (!Number.isFinite(value) || (value ?? 0) <= 0)) return setMsg({ ok: false, text: "Project value must be a positive number of rupees." });
          void save({ conversionStatus: f.get("conversionStatus"), projectValueInr: value }, "Conversion");
        }}
      >
        <label className="f">
          Result
          <select name="conversionStatus" defaultValue={p.conversionStatus}>
            <option value="UNKNOWN">Not yet recorded</option>
            <option value="CONVERTED">Won the project</option>
            <option value="LOST">Lost</option>
          </select>
        </label>
        <label className="f">
          Signed project value (₹)
          <input name="value" inputMode="numeric" defaultValue={p.projectValueInr ? String(Math.round(Number(p.projectValueInr))) : ""} placeholder="only if won" />
        </label>
        <button className="btn ghost" disabled={busy}>Save result</button>
      </form>

      {p.humanReviewStatus === "OPEN" ? (
        <button className="btn ghost" disabled={busy} onClick={() => save({ humanReviewStatus: "RESOLVED" }, "Follow-up")}>
          Mark follow-up done
        </button>
      ) : null}
    </div>
  );
}

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<string | null>(null);
  return (
    <span>
      <button
        className="btn ghost"
        disabled={state === "Sending…"}
        onClick={async () => {
          setState("Sending…");
          const res = await fetch(`/api/notifications/${id}/retry`, { method: "POST" });
          const j = await res.json().catch(() => ({}));
          setState(res.ok ? `Result: ${j.notification?.status ?? "done"}` : `Couldn't resend: ${j.error ?? res.statusText}`);
          router.refresh();
        }}
      >
        Resend to Telegram
      </button>{" "}
      {state ? <span className="small" role="status">{state}</span> : null}
    </span>
  );
}
