import Link from "next/link";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { istDateTime } from "@/components/format";
import { Tag } from "@/components/Tag";
import { config } from "@/lib/config/env";
import { db } from "@/lib/db/client";
import { callEvents, enquiries } from "@/lib/db/schema";
import { enquiryRef } from "@/lib/notifications/format";

/** The queue someone at the studio should clear every morning. Priority is shown in words and symbols, not colour alone. */
export default async function AttentionPage({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const sp = await searchParams;
  const includeDemo = sp.demo ? sp.demo === "1" : config().VOICE_PROVIDER === "mock";
  const demoCond = includeDemo ? undefined : eq(enquiries.isDemo, false);
  const rows = await db()
    .select()
    .from(enquiries)
    .where(and(or(eq(enquiries.humanReviewStatus, "OPEN"), eq(enquiries.notificationStatus, "FAILED")), demoCond))
    .orderBy(sql`case ${enquiries.priority} when 'URGENT' then 0 when 'HIGH' then 1 else 2 end`, desc(enquiries.callArrivedAt))
    .limit(200);
  const failedEvents = await db()
    .select()
    .from(callEvents)
    .where(and(eq(callEvents.processingStatus, "FAILED"), includeDemo ? undefined : eq(callEvents.isDemo, false)))
    .orderBy(desc(callEvents.receivedAt))
    .limit(50);

  const groups: { title: string; hint: string; items: typeof rows }[] = [
    { title: "Urgent: existing clients", hint: "Call back today. The caller was told it's a priority; no time was promised.", items: rows.filter((r) => r.disposition === "URGENT_ESCALATION") },
    { title: "Handoffs that didn't reach Telegram", hint: "The enquiry is safe. Resend from its page, or call the designer.", items: rows.filter((r) => r.notificationStatus === "FAILED" && r.disposition !== "URGENT_ESCALATION") },
    { title: "Missed calls", hint: "Automatic callbacks are off by design. Call these numbers back.", items: rows.filter((r) => r.disposition === "MISSED") },
    { title: "Asked for a person, or a repeat caller", hint: "Qualified or not, the caller wants a human.", items: rows.filter((r) => r.priority === "HIGH" && !["MISSED", "URGENT_ESCALATION"].includes(r.disposition) && r.notificationStatus !== "FAILED") },
    { title: "Decisions the rules can't make", hint: "Edge cases from the documents: tight timelines, small commercial spaces, structural work.", items: rows.filter((r) => r.disposition === "HUMAN_REVIEW" && r.priority !== "HIGH") },
    { title: "Calls that ended early", hint: "Disconnected or still unclear on scope, area or timeline.", items: rows.filter((r) => r.disposition === "INCOMPLETE" && r.priority !== "HIGH" && r.notificationStatus !== "FAILED") },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Needs attention</h1>
          <p>{rows.length ? `${rows.length} open item${rows.length === 1 ? "" : "s"}, most urgent first.` : "Nothing is waiting. New items appear here as calls come in."}</p>
        </div>
        <form method="get" className="filters">
          <label className="f">
            Demo calls
            <select name="demo" defaultValue={includeDemo ? "1" : "0"}>
              <option value="0">Hide</option>
              <option value="1">Include</option>
            </select>
          </label>
          <button className="btn ghost">Update</button>
        </form>
      </div>
      {failedEvents.length ? (
        <div className="alert err">
          <b>{failedEvents.length} provider event{failedEvents.length === 1 ? "" : "s"} failed to process.</b> They are stored and retried automatically by the background job. Latest error: {failedEvents[0]!.lastError}
        </div>
      ) : null}
      <div className="stack">
        {groups.filter((g) => g.items.length).map((g) => (
          <section key={g.title} className="panel" aria-label={g.title}>
            <h2>{g.title} ({g.items.length})</h2>
            <p className="small muted">{g.hint}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Enquiry</th><th>Received</th><th>Caller</th><th>Why it&apos;s here</th><th>Priority</th></tr></thead>
                <tbody>
                  {g.items.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={`/enquiries/${r.id}`}>{enquiryRef(r)}</Link> {r.isDemo ? <Tag value="DEMO" label="Demo" /> : null}</td>
                      <td className="small">{istDateTime(r.callArrivedAt)}</td>
                      <td>{r.callerName ?? r.callerPhone ?? "Unknown"}</td>
                      <td className="small">{r.notificationStatus === "FAILED" ? "Telegram delivery failed. " : ""}{r.humanReviewReason}</td>
                      <td><Tag value={r.priority} label={r.priority === "URGENT" ? "Urgent" : r.priority === "HIGH" ? "High" : "Normal"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
