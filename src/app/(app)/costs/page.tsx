import { and, desc, eq, gte, lt } from "drizzle-orm";
import { Fig } from "@/components/Fig";
import { inr, istDateTime } from "@/components/format";
import { isoDay, PeriodForm } from "@/components/PeriodForm";
import { Tag } from "@/components/Tag";
import { overview, parsePeriod } from "@/lib/analytics/queries";
import { db } from "@/lib/db/client";
import { costRates, costRecords } from "@/lib/db/schema";

export default async function CostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = parsePeriod(await searchParams);
  const o = await overview(p);
  const rates = await db().select().from(costRates).where(eq(costRates.active, true));
  const lines = await db()
    .select()
    .from(costRecords)
    .where(and(gte(costRecords.incurredAt, p.from), lt(costRecords.incurredAt, p.to), p.includeDemo ? undefined : eq(costRecords.isDemo, false)))
    .orderBy(desc(costRecords.incurredAt))
    .limit(200);
  const k = o.costs;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Costs</h1>
          <p>What the system cost from {isoDay(p.from)} to {isoDay(p.to)}. Actual, estimated and unknown amounts are kept apart and never added together.</p>
        </div>
        <PeriodForm action="/costs" from={isoDay(p.from)} to={isoDay(p.to)} demo={p.includeDemo} />
      </div>
      {!rates.some((r) => r.category === "voice_minute" && r.provider === "vaaniyantra") ? (
        <div className="alert">
          No VaaniYantra per-minute rate is set, so call costs show as <b>unknown</b>. Add the rate from your VaaniYantra billing page in <a href="/settings">Settings</a>. The app has no built-in price for any provider.
        </div>
      ) : null}
      <section className="panel">
        <dl className="figs">
          <Fig label="Actual" value={k.actualLines ? inr(k.actual) : "None recorded"} na={!k.actualLines} sub="invoices and provider-reported" def="Sum of ACTUAL cost lines: amounts a provider reported, or invoices an admin entered." />
          <Fig label="Estimated" value={k.estimatedLines ? inr(k.estimated) : "Unknown"} na={!k.estimatedLines} sub="minutes × configured rate" def="Sum of ESTIMATED lines: billable minutes × the configured rate. Each line names its rate source." />
          <Fig label="Unknown lines" value={k.unknownCount} sub={`${k.callsWithUnknownCost} calls affected`} def="Lines with no rate configured. These are not ₹0, and they make per-unit figures N/A." />
          <Fig label="Est. per completed call" value={inr(k.estimatedCostPerHandledCall)} def="Estimated call costs ÷ handled calls. N/A if any call cost is unknown." na={k.estimatedCostPerHandledCall === null} />
          <Fig label="Est. per qualified enquiry" value={inr(k.estimatedCostPerQualifiedLead)} def="Estimated call costs ÷ qualified enquiries." na={k.estimatedCostPerQualifiedLead === null} />
          <Fig label="Actual per qualified enquiry" value={inr(k.actualCostPerQualifiedLead)} def="Actual costs (e.g. the monthly invoice) ÷ qualified enquiries in the same period." na={k.actualCostPerQualifiedLead === null} />
          <Fig label="Est. per won project" value={o.outcomes.converted ? inr(k.estimatedCostPerConversion) : "Not yet recorded"} def="Estimated call costs ÷ enquiries staff marked as won." na={k.estimatedCostPerConversion === null} />
        </dl>
      </section>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>By provider</h2>
          <table>
            <thead><tr><th>Provider</th><th className="num">Actual</th><th className="num">Estimated</th><th className="num">Unknown lines</th></tr></thead>
            <tbody>{k.byProvider.length ? k.byProvider.map((r) => <tr key={r.key}><td>{r.key}</td><td className="num">{inr(r.actual)}</td><td className="num">{inr(r.estimated)}</td><td className="num">{r.unknown}</td></tr>) : <tr><td colSpan={4} className="muted">No cost lines in this period.</td></tr>}</tbody>
          </table>
        </section>
        <section className="panel">
          <h2>By category</h2>
          <table>
            <thead><tr><th>Category</th><th className="num">Actual</th><th className="num">Estimated</th><th className="num">Unknown lines</th></tr></thead>
            <tbody>{k.byCategory.length ? k.byCategory.map((r) => <tr key={r.key}><td>{r.key.replace(/_/g, " ")}</td><td className="num">{inr(r.actual)}</td><td className="num">{inr(r.estimated)}</td><td className="num">{r.unknown}</td></tr>) : <tr><td colSpan={4} className="muted">No cost lines in this period.</td></tr>}</tbody>
          </table>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Rates in use</h2>
        {rates.length ? (
          <table>
            <thead><tr><th>Provider</th><th>Category</th><th>Rate</th><th>Source</th><th>Since</th></tr></thead>
            <tbody>{rates.map((r) => <tr key={r.id}><td>{r.provider}</td><td>{r.category.replace("_", " ")}</td><td>{r.currency} {r.rate} per {r.unit.replace(/_/g, " ")}</td><td className="small">{r.source}</td><td className="small">{istDateTime(r.createdAt)}</td></tr>)}</tbody>
          </table>
        ) : <p className="muted">No rates configured.</p>}
      </section>

      <section style={{ marginTop: 16 }}>
        <h2 style={{ marginBottom: 10 }}>Cost lines</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Provider</th><th>What</th><th>Type</th><th className="num">Amount</th><th>Rate source</th></tr></thead>
            <tbody>
              {lines.length ? lines.map((c) => (
                <tr key={c.id}>
                  <td className="small">{istDateTime(c.incurredAt)}</td>
                  <td>{c.provider}{c.isDemo ? <> <Tag value="DEMO" label="Demo" /></> : null}</td>
                  <td className="small">{c.category.replace(/_/g, " ")}: {c.quantity ?? "?"} {c.unit.replace(/_/g, " ")}</td>
                  <td><Tag value={c.valueType} label={c.valueType === "UNKNOWN" ? "Unknown" : undefined} /></td>
                  <td className="num">{c.amount === null ? "Unknown" : inr(Number(c.amount))}</td>
                  <td className="small">{c.rateSource}</td>
                </tr>
              )) : <tr><td colSpan={6} className="empty">No cost lines in this period.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
