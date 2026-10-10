import Link from "next/link";
import { notFound } from "next/navigation";
import { EnquiryActions, RetryButton } from "@/components/EnquiryActions";
import { inr, istDateTime, LABEL } from "@/components/format";
import { Tag } from "@/components/Tag";
import { requireUser } from "@/lib/auth/guard";
import { getEnquiryDetail } from "@/lib/enquiries/service";
import { enquiryRef } from "@/lib/notifications/format";
import type { CriterionResult } from "@/lib/qualification/types";

export default async function EnquiryDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const d = await getEnquiryDetail((await params).id);
  if (!d) notFound();
  const e = d.enquiry;
  const a = d.assessments[0];
  const criteria = (a?.criteria ?? []) as CriterionResult[];
  const transcript = (e.transcript ?? []) as { role: string; text: string; atMs?: number }[];
  const latency = e.firstResponseAt && e.callArrivedAt ? (e.firstResponseAt.getTime() - e.callArrivedAt.getTime()) / 1000 : null;

  return (
    <>
      <p className="small"><Link href="/enquiries">All enquiries</Link></p>
      <div className="page-head">
        <div>
          <h1>{e.callerName ?? "Caller didn't give a name"}</h1>
          <p>
            Enquiry {enquiryRef(e)}{" "}
            <Tag value={e.disposition} /> <Tag value={e.callStatus} /> {e.priority !== "NORMAL" ? <Tag value={e.priority} label={`${LABEL[e.priority]} priority`} /> : null}{" "}
            {e.isDemo ? <Tag value="DEMO" label="Demo call: not a real enquiry" /> : null} {e.pricingViolation ? <Tag value="URGENT" label="Agent may have quoted a price" /> : null}
          </p>
        </div>
      </div>

      {e.humanReviewStatus === "OPEN" ? (
        <div className="alert" role="note">
          <b>Follow-up needed.</b> {e.humanReviewReason}
        </div>
      ) : null}

      <div className="grid g2">
        <section className="panel" aria-labelledby="det-h">
          <h2 id="det-h">What the caller told us</h2>
          <dl className="kv">
            <dt>Received</dt><dd>{istDateTime(e.callArrivedAt)}{e.durationSec !== null ? `, ${Math.round(e.durationSec / 60 * 10) / 10} min call` : ""}</dd>
            <dt>Phone</dt><dd>{e.callerPhone ?? "Not available"} {e.callerPhone ? <span className="small muted">({e.callerPhoneVerified ? "from call metadata" : "demo / unverified"})</span> : null}</dd>
            <dt>Caller type</dt><dd>{e.callerType === "EXISTING_CLIENT" ? "Existing client" : e.callerType === "NEW_PROSPECT" ? "New enquiry" : "Unknown"}</dd>
            <dt>Project</dt><dd>{[e.projectCategory?.toLowerCase(), e.propertyType].filter(Boolean).join(", ") || "Not described"}</dd>
            <dt>Location</dt><dd>{e.locality ?? "Not given"}</dd>
            <dt>Scope</dt><dd>{e.scopeSummary ?? "Not described"}</dd>
            <dt>Carpet area</dt><dd>{e.carpetAreaSqFt ? `${e.carpetAreaSqFt} sq ft` : "Not given"}</dd>
            <dt>Timeline</dt><dd>{e.timelineSummary ?? "Not given"}</dd>
            <dt>Site</dt><dd>{e.siteReadiness ?? "Not given"}</dd>
            <dt>Decision-maker</dt><dd>{e.decisionMakerStatus}</dd>
            <dt>Budget</dt><dd>{e.budgetVolunteered ? `Volunteered: ${e.budgetVolunteered}` : "Not mentioned (not asked, by policy)"}</dd>
            <dt>Referral</dt><dd>{e.referralSource ?? "—"}</dd>
            <dt>Asked about price</dt><dd>{e.pricingQuestionCount ? `${e.pricingQuestionCount}× (given the approved response)` : "No"}</dd>
            {e.escalationRecipient ? (<><dt>Wants to hear from</dt><dd>{e.escalationRecipient}</dd></>) : null}
            <dt>Consultation</dt><dd><Tag value={e.consultationStatus} /></dd>
            <dt>Result</dt><dd><Tag value={e.conversionStatus} />{e.projectValueInr ? ` ${inr(Number(e.projectValueInr), 0)}` : ""}</dd>
          </dl>
          {d.related ? (
            <p className="small" style={{ marginTop: 10 }}>
              Linked call from the same number: <Link href={`/enquiries/${d.related.id}`}>{enquiryRef(d.related)}</Link> ({LABEL[d.related.callStatus]})
            </p>
          ) : null}
        </section>

        <section className="panel" aria-labelledby="q-h">
          <h2 id="q-h">Why this outcome</h2>
          {a ? (
            <>
              {criteria.map((c) => (
                <div key={c.id} className={`crit ${c.status}`}>
                  <b>{c.label}</b>: {c.status === "NOT_APPLICABLE" ? "not applicable" : c.status.toLowerCase()}
                  <div className="small">{c.reason}</div>
                  {c.reviewFlag ? <div className="small"><b>Review:</b> {c.reviewFlag}</div> : null}
                  {c.evidence.slice(0, 2).map((ev, i) => (
                    <blockquote key={i}>“{ev}”</blockquote>
                  ))}
                </div>
              ))}
              {(a.uncertainties as string[]).length ? (
                <>
                  <h3 style={{ marginTop: 12 }}>Uncertainties passed to the designer</h3>
                  <ul className="small">{(a.uncertainties as string[]).map((u) => <li key={u}>{u}</li>)}</ul>
                </>
              ) : null}
              <p className="small muted">Rules version {a.ruleVersion}, assessed {istDateTime(a.assessedAt)}.</p>
            </>
          ) : (
            <p className="muted">No qualification: {e.disposition === "MISSED" ? "nobody spoke to the caller." : "no assessment stored."}</p>
          )}
        </section>

        <section className="panel" aria-labelledby="h-h">
          <h2 id="h-h">Telegram handoff</h2>
          {d.notifications.length === 0 ? (
            <p className="muted">No handoff. {e.disposition === "NOT_QUALIFIED" ? "Declined enquiries are never sent to designers." : "Only qualified enquiries, urgent complaints and missed calls create one."}</p>
          ) : (
            d.notifications.map((n) => (
              <div key={n.id} className="stack">
                <p>
                  <Tag value={n.status} /> {n.category === "QUALIFIED_HANDOFF" ? "New-lead handoff" : n.category === "URGENT_ESCALATION" ? "Urgent escalation" : "Missed-call notice"}, {n.attemptCount} attempt{n.attemptCount === 1 ? "" : "s"}
                  {n.sentAt ? `, delivered ${istDateTime(n.sentAt)}` : ""}
                  {n.errorCategory ? <span className="small">. Error: {n.errorCategory}{n.errorDetail ? ` (${n.errorDetail})` : ""}</span> : null}
                </p>
                {n.status === "SIMULATED" ? <p className="small muted">Demo: this message was previewed, not sent.</p> : null}
                {n.status === "FAILED" || n.status === "UNAVAILABLE" ? <RetryButton id={n.id} /> : null}
                <pre className="msg" aria-label="Message preview">{n.messagePreview}</pre>
              </div>
            ))
          )}
        </section>

        <section className="panel" aria-labelledby="t-h">
          <h2 id="t-h">Timing and cost</h2>
          <dl className="kv">
            <dt>First voice response</dt>
            <dd>{latency !== null ? `${Math.round(latency)} s after the call arrived (${e.firstResponseMethod})` : "Not measurable for this call"}</dd>
            <dt>Record completed</dt><dd>{istDateTime(e.recordCompletedAt)}</dd>
            <dt>Qualified at</dt><dd>{istDateTime(e.qualifiedAt)}</dd>
            <dt>Designer notified</dt><dd>{istDateTime(d.notifications.find((n) => n.sentAt)?.sentAt ?? null)}</dd>
          </dl>
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Cost line</th><th>Type</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {d.costs.map((c) => (
                <tr key={c.id}>
                  <td className="small">{c.provider} {c.category.replace("_", " ")}<br /><span className="muted">{c.quantity ?? "?"} {c.unit} × {c.rateValue ? `₹${c.rateValue}` : "no rate"}. Source: {c.rateSource}</span></td>
                  <td><Tag value={c.valueType} label={c.valueType === "UNKNOWN" ? "Unknown" : undefined} /></td>
                  <td className="num">{c.amount === null ? "Unknown" : inr(Number(c.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="panel" aria-labelledby="a-h">
          <h2 id="a-h">Update this enquiry</h2>
          <EnquiryActions id={e.id} disposition={e.disposition} consultationStatus={e.consultationStatus} conversionStatus={e.conversionStatus} humanReviewStatus={e.humanReviewStatus} projectValueInr={e.projectValueInr} />
        </section>
        <section className="panel" aria-labelledby="tr-h">
          <h2 id="tr-h">Transcript</h2>
          {e.providerSummary ? <p className="small"><b>Provider summary</b> (for reference, not used for decisions): {e.providerSummary}</p> : null}
          {transcript.length === 0 ? (
            <p className="muted">No transcript for this call.</p>
          ) : user.role !== "ADMIN" ? (
            <p className="muted">Transcripts are visible to admins only.</p>
          ) : (
            <details>
              <summary>Show {transcript.length} turns</summary>
              <div className="transcript">
                {transcript.map((t, i) => (
                  <div key={i} className={`turn ${t.role}`}>
                    <b>{t.role === "AGENT" ? "Assistant" : "Caller"}</b>
                    <span>{t.text}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }} aria-labelledby="ev-h">
        <h2 id="ev-h">Event history</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>What</th><th>Who</th><th>Details</th></tr></thead>
            <tbody>
              {d.events.map((ev) => (
                <tr key={ev.id}>
                  <td className="small">{istDateTime(ev.receivedAt)}</td>
                  <td>Provider event {ev.eventType}: {ev.processingStatus.toLowerCase()}</td>
                  <td className="small">provider</td>
                  <td className="small">{ev.deliveries > 1 ? `delivered ${ev.deliveries}× (deduplicated). ` : ""}{ev.lastError ?? ""}</td>
                </tr>
              ))}
              {d.audit.map((ev) => (
                <tr key={ev.id}>
                  <td className="small">{istDateTime(ev.at)}</td>
                  <td>{ev.action}</td>
                  <td className="small">{ev.actorType}{ev.actorId ? ` ${ev.actorId.slice(0, 8)}` : ""}</td>
                  <td className="small"><code>{ev.details ? JSON.stringify(ev.details).slice(0, 160) : ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
