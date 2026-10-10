"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import type { Scenario } from "@/lib/conversation/scenarios";

interface Turn { role: "AGENT" | "CALLER"; text: string; branch?: string }
interface Crit { id: string; label: string; status: string; reason: string; reviewFlag?: string }
interface Assessment { disposition: string; criteria: Crit[]; priority: string; uncertainties: string[]; clarification?: { question: string } }

const BRANCH: Record<string, string> = {
  OPENING: "opening line",
  PRICING_GUARDRAIL: "pricing guardrail: approved response, verbatim",
  INTERNAL_INFO_REFUSAL: "refused request for internal information",
  URGENT_ESCALATION: "existing-client escalation",
  HUMAN_REQUEST: "human requested: no live transfer available",
  DECLINE: "polite decline",
  CLARIFY: "one clarifying question",
  COLLECT: "collecting details",
  HUMAN_REVIEW_CLOSE: "sent for human review",
  QUALIFIED_CLOSE: "qualified: consultation request recorded, not booked",
  INCOMPLETE_CLOSE: "ended before details were clear",
  CALLER_ENDED: "caller ended the call",
};

export function Simulator({ scenarios }: { scenarios: Scenario[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [state, setState] = useState<unknown>(null);
  const [sig, setSig] = useState<string>("");
  const [ended, setEnded] = useState(false);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ enquiryId?: string; status: string } | null>(null);
  const [phone, setPhone] = useState("+910000000999");
  const [providerFail, setProviderFail] = useState(false);
  const [telegramFail, setTelegramFail] = useState(false);
  const [scenarioId, setScenarioId] = useState("");
  const chatRef = useRef<HTMLDivElement>(null);

  const scroll = () => setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }), 30);

  async function call(body: object) {
    const res = await fetch("/api/simulator/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? res.statusText);
    return j;
  }

  async function start() {
    setBusy(true);
    setError(null);
    setResult(null);
    setEnded(false);
    setAssessment(null);
    try {
      const j = await call({});
      setState(j.state);
      setSig(j.sig);
      setTurns([{ role: "AGENT", text: j.reply, branch: j.branch }]);
      return { state: j.state, sig: j.sig };
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function say(line: string, s = state, g = sig) {
    if (!line.trim()) return null;
    setBusy(true);
    setError(null);
    try {
      const j = await call({ text: line, state: s, sig: g });
      setState(j.state);
      setSig(j.sig);
      setAssessment(j.assessment);
      setTurns((t) => [...t, { role: "CALLER", text: line }, { role: "AGENT", text: j.reply, branch: j.branch }]);
      if (j.state.phase === "ENDED") setEnded(true);
      scroll();
      return j;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function finish(outcome: "COMPLETED" | "MISSED" | "DISCONNECTED", s = state, g = sig, opts?: { providerFailure?: boolean; telegramFailure?: boolean; phone?: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/simulator/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: s, sig: g, outcome, callerPhone: opts?.phone ?? phone, simulateProviderFailure: opts?.providerFailure ?? providerFail, simulateTelegramFailure: opts?.telegramFailure ?? telegramFail }),
      });
      const j = await res.json();
      if (!res.ok && !j.status) throw new Error(j.error ?? res.statusText);
      setResult(j);
      setEnded(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runScenario() {
    const sc = scenarios.find((x) => x.id === scenarioId);
    if (!sc) return;
    setPhone(sc.callerPhone);
    setProviderFail(Boolean(sc.inject?.providerFailure));
    setTelegramFail(Boolean(sc.inject?.telegramFailure));
    if (sc.outcome === "MISSED") {
      setTurns([]);
      setAssessment(null);
      setResult(null);
      return finish("MISSED", null, "", { phone: sc.callerPhone, providerFailure: false, telegramFailure: false });
    }
    const st = await start();
    if (!st) return;
    let s: unknown = st.state;
    let g: string = st.sig;
    for (const line of sc.lines) {
      const j = await say(line, s, g);
      if (!j) return;
      s = j.state;
      g = j.sig;
      if (j.state.phase === "ENDED") break;
    }
    await finish(sc.outcome ?? "COMPLETED", s, g, { phone: sc.callerPhone, providerFailure: sc.inject?.providerFailure, telegramFailure: sc.inject?.telegramFailure });
  }

  const sc = scenarios.find((x) => x.id === scenarioId);
  return (
    <div className="sim">
      <section className="panel" aria-labelledby="call-h">
        <h2 id="call-h">Simulated call <span className="tag t-DEMO">Demo</span></h2>
        <div className="filters">
          <label className="f" style={{ flex: 1, minWidth: 220 }}>
            Scenario from the September calls
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              <option value="">Choose a scenario…</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.title} ({s.source})</option>
              ))}
            </select>
          </label>
          <button className="btn" disabled={!scenarioId || busy} onClick={runScenario}>Play scenario</button>
          <button className="btn ghost" disabled={busy} onClick={start}>Start a blank call</button>
        </div>
        {sc ? <p className="small muted">Expected: {sc.expected}</p> : null}
        {error ? <div className="alert err" role="alert">{error}</div> : null}
        <div className="chat" ref={chatRef} aria-live="polite">
          {turns.length === 0 ? <p className="empty">Play a scenario or start a blank call, then talk to the assistant as a caller would.</p> : null}
          {turns.map((t, i) => (
            <div key={i} className={`bubble ${t.role}`}>
              {t.text}
              {t.branch ? <span className="branch">{BRANCH[t.branch] ?? t.branch}</span> : null}
            </div>
          ))}
        </div>
        <form
          className="say"
          onSubmit={(e) => {
            e.preventDefault();
            const v = text;
            setText("");
            void say(v);
          }}
        >
          <label htmlFor="say" className="small" style={{ position: "absolute", left: -9999 }}>Caller says</label>
          <input id="say" value={text} onChange={(e) => setText(e.target.value)} placeholder={ended ? "Call ended. Start a new one above." : state ? "Type what the caller says…" : "Start a call first"} disabled={!state || ended || busy} maxLength={2000} />
          <button className="btn" disabled={!state || ended || busy || !text.trim()}>Say</button>
        </form>
        <div className="filters" style={{ marginTop: 12 }}>
          <label className="f">
            Caller number (demo)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} size={16} />
          </label>
          <label className="f" style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={providerFail} onChange={(e) => setProviderFail(e.target.checked)} style={{ minHeight: 0 }} /> Simulate provider failure
          </label>
          <label className="f" style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={telegramFail} onChange={(e) => setTelegramFail(e.target.checked)} style={{ minHeight: 0 }} /> Simulate Telegram failure
          </label>
        </div>
        <div className="filters">
          <button className="btn" disabled={!state || busy || Boolean(result)} onClick={() => finish("COMPLETED")}>End call and save</button>
          <button className="btn ghost" disabled={!state || busy || Boolean(result)} onClick={() => finish("DISCONNECTED")}>Drop the call</button>
          <button className="btn ghost" disabled={busy} onClick={() => { setTurns([]); setState(null); setAssessment(null); void finish("MISSED", null, ""); }}>Record a missed call</button>
        </div>
        {result ? (
          <div className={`alert ${result.status === "FAILED" ? "err" : "ok"}`} role="status">
            Saved as a demo enquiry ({result.status.toLowerCase()}).{" "}
            {result.enquiryId ? <Link href={`/enquiries/${result.enquiryId}`}>Open the enquiry, its qualification and the Telegram preview</Link> : null}
          </div>
        ) : null}
      </section>

      <section className="panel" aria-labelledby="rules-h">
        <h2 id="rules-h">What the rules see</h2>
        {!assessment ? (
          <p className="muted">Nikhil&apos;s five criteria update after each thing the caller says. The decision comes from fixed rules, not from the AI.</p>
        ) : (
          <>
            <p>Current outcome: <span className={`tag t-${assessment.disposition === "NEEDS_CLARIFICATION" ? "INCOMPLETE" : assessment.disposition}`}>{assessment.disposition.replace(/_/g, " ").toLowerCase()}</span> {assessment.priority !== "NORMAL" ? <span className={`tag t-${assessment.priority}`}>{assessment.priority.toLowerCase()} priority</span> : null}</p>
            {assessment.criteria.map((c) => (
              <div key={c.id} className={`crit ${c.status}`}>
                <b>{c.label}</b>: {c.status === "NOT_APPLICABLE" ? "not applicable" : c.status.toLowerCase()}
                <div className="small">{c.reason}</div>
                {c.reviewFlag ? <div className="small"><b>Review:</b> {c.reviewFlag}</div> : null}
              </div>
            ))}
            {assessment.uncertainties.length ? <ul className="small">{assessment.uncertainties.map((u) => <li key={u}>{u}</li>)}</ul> : null}
          </>
        )}
      </section>
    </div>
  );
}
