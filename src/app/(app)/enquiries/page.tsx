import Link from "next/link";
import { istDateTime } from "@/components/format";
import { Tag } from "@/components/Tag";
import { enquiryRef } from "@/lib/notifications/format";
import { listEnquiries, parseListQuery } from "@/lib/enquiries/service";

const opts = {
  disposition: ["QUALIFIED", "NOT_QUALIFIED", "INCOMPLETE", "HUMAN_REVIEW", "URGENT_ESCALATION", "MISSED"],
  callStatus: ["COMPLETED", "MISSED", "DISCONNECTED", "FAILED"],
  notification: ["SENT", "FAILED", "UNAVAILABLE", "SIMULATED", "NOT_REQUIRED"],
};
const NICE: Record<string, string> = { QUALIFIED: "Qualified", NOT_QUALIFIED: "Declined", INCOMPLETE: "Incomplete", HUMAN_REVIEW: "Needs review", URGENT_ESCALATION: "Urgent", MISSED: "Missed", COMPLETED: "Completed", DISCONNECTED: "Disconnected", FAILED: "Failed", SENT: "Sent", UNAVAILABLE: "Telegram not set up", SIMULATED: "Simulated", NOT_REQUIRED: "Not needed" };

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = parseListQuery(sp);
  const { rows, total, page, pageSize } = await listEnquiries(q);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (patch: Record<string, string | number>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...q, ...patch })) if (v !== undefined && v !== "" && !(k === "pageSize" && v === 25) && !(k === "sort" && v === "newest")) u.set(k, String(v));
    return `/enquiries?${u.toString()}`;
  };
  const select = (name: keyof typeof opts, label: string) => (
    <label className="f">
      {label}
      <select name={name} defaultValue={(q[name] as string) ?? ""}>
        <option value="">Any</option>
        {opts[name].map((o) => (
          <option key={o} value={o}>
            {NICE[o] ?? o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Enquiries</h1>
          <p>Every incoming phone call, newest first. {total} match{total === 1 ? "es" : ""} your filters.</p>
        </div>
      </div>
      <form className="filters" method="get" action="/enquiries" aria-label="Filter enquiries">
        <label className="f">
          Search
          <input type="search" name="q" defaultValue={q.q} placeholder="Name, area, phone" />
        </label>
        {select("disposition", "Outcome")}
        {select("callStatus", "Call")}
        {select("notification", "Handoff")}
        <label className="f">
          Review
          <select name="review" defaultValue={q.review ?? ""}>
            <option value="">Any</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
        <label className="f">
          Project
          <select name="category" defaultValue={q.category ?? ""}>
            <option value="">Any</option>
            <option value="RESIDENTIAL">Residential</option>
            <option value="COMMERCIAL">Commercial</option>
          </select>
        </label>
        <label className="f">
          Area
          <input name="locality" defaultValue={q.locality} placeholder="e.g. Baner" size={10} />
        </label>
        <label className="f">
          From
          <input type="date" name="from" defaultValue={q.from} />
        </label>
        <label className="f">
          To
          <input type="date" name="to" defaultValue={q.to} />
        </label>
        <label className="f">
          Demo calls
          <select name="demo" defaultValue={q.demo ?? "0"}>
            <option value="0">Hide</option>
            <option value="1">Include</option>
            <option value="only">Only demo</option>
          </select>
        </label>
        <label className="f">
          Sort
          <select name="sort" defaultValue={q.sort}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="priority">Priority</option>
          </select>
        </label>
        <button className="btn" type="submit">
          Apply filters
        </button>
        <Link className="btn ghost" href="/enquiries">
          Clear
        </Link>
      </form>

      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">
            No enquiries match. Clear the filters, or include demo calls if you&apos;ve only used the simulator so far.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Enquiry</th>
                <th scope="col">Received</th>
                <th scope="col">Caller</th>
                <th scope="col">Project</th>
                <th scope="col">Outcome</th>
                <th scope="col">Priority</th>
                <th scope="col">Handoff</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/enquiries/${r.id}`}>{enquiryRef(r)}</Link> {r.isDemo ? <Tag value="DEMO" label="Demo" /> : null}
                  </td>
                  <td className="small">{istDateTime(r.callArrivedAt)}</td>
                  <td>{r.callerName ?? <span className="muted">Not given</span>}</td>
                  <td className="small">
                    {[r.propertyType, r.locality].filter(Boolean).join(", ") || <span className="muted">—</span>}
                  </td>
                  <td>
                    <Tag value={r.disposition} />
                    {r.callStatus !== "COMPLETED" && r.callStatus !== r.disposition ? <> <Tag value={r.callStatus} /></> : null}
                  </td>
                  <td>{r.priority !== "NORMAL" ? <Tag value={r.priority} /> : <span className="muted small">Normal</span>}</td>
                  <td>
                    <Tag value={r.notificationStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <nav className="pager" aria-label="Pages">
        {page > 1 ? <Link className="btn ghost" href={qs({ page: page - 1 })}>Previous</Link> : null}
        <span className="small muted">
          Page {page} of {pages}
        </span>
        {page < pages ? <Link className="btn ghost" href={qs({ page: page + 1 })}>Next</Link> : null}
      </nav>
    </>
  );
}
