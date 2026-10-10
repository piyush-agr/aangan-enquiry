import Link from "next/link";
import { Fig } from "@/components/Fig";
import { inr, pct, secs } from "@/components/format";
import { HourRing } from "@/components/HourRing";
import { isoDay, PeriodForm } from "@/components/PeriodForm";
import { hourlyArrivals, overview, parsePeriod } from "@/lib/analytics/queries";

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const p = parsePeriod(sp);
  const [o, hours] = await Promise.all([overview(p), hourlyArrivals(p)]);
  const c = o.calls;
  const outside = hours.filter((h) => h.hour < 10 || h.hour >= 19).reduce((a, h) => a + h.total, 0);
  const r = o.response;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p>
            Phone enquiries from {isoDay(p.from)} to {isoDay(p.to)}
            {p.includeDemo ? ", including demo calls" : ""}. Every figure is computed from stored call records.
          </p>
        </div>
        <PeriodForm action="/" from={isoDay(p.from)} to={isoDay(p.to)} demo={p.includeDemo} />
      </div>

      {c.total === 0 ? (
        <div className="panel empty">
          <h2>No calls in this period yet</h2>
          <p style={{ margin: "8px auto" }}>
            {p.includeDemo ? "Try a wider date range." : "Real calls appear here once VaaniYantra is connected. To see how it works now, "}
            {!p.includeDemo ? (
              <>
                <Link href="/simulator">run a simulated call</Link> and then tick “Include demo calls”.
              </>
            ) : null}
          </p>
        </div>
      ) : (
        <div className="stack">
          <section className="panel hero" aria-labelledby="day-night">
            <HourRing hours={hours} />
            <div className="hero-text">
              <p className="big">{c.total ? Math.round((outside / c.total) * 100) : 0}%</p>
              <h2 id="day-night">of calls arrived outside front-desk hours</h2>
              <p className="muted" style={{ marginTop: 8 }}>
                {outside} of {c.total} calls came before 10am or after 7pm. The baseline from the case was about one in three.
              </p>
              <dl className="figs" style={{ marginTop: 14 }}>
                <Fig label="Answered within 5 min" value={pct(r.withinFiveMinutes.value)} sub={`${r.withinFiveMinutes.numerator} of ${r.withinFiveMinutes.denominator} measurable, ${r.unmeasurable} not measurable`} def="Calls whose first agent voice response came ≤ 5 minutes after the call arrived ÷ calls with reliable timestamps. Missed and failed calls count as not answered. Calls without a reliable start or response time are excluded and counted separately." na={r.withinFiveMinutes.value === null} />
                <Fig label="Median first response" value={secs(r.medianFirstResponseSec)} sub={`average ${secs(r.avgFirstResponseSec)}`} def="Time from call arrival to the agent's first spoken words, for calls where both timestamps are known. Provider start time plus the transcript offset of the first agent turn; never the webhook arrival time." na={r.medianFirstResponseSec === null} />
              </dl>
            </div>
          </section>

          <section className="panel" aria-labelledby="calls-h">
            <h2 id="calls-h">Calls and qualification</h2>
            <dl className="figs">
              <Fig label="Incoming calls" value={c.total} def="Unique provider call IDs that arrived in the period. Repeated webhooks for the same call are not counted again." />
              <Fig label="Handled" value={c.handled} sub="completed with an outcome" def="Completed calls that reached a usable outcome: qualified, declined, sent for review, or escalated. Calls that ended before the details were clear are not counted." />
              <Fig label="Missed or failed" value={c.unansweredOrFailed} sub={`${c.disconnected} disconnected separately`} def="Calls the provider reported as missed (no answer/busy) or failed. Disconnected calls are reported separately." />
              <Fig label="Qualified" value={c.qualified} def="Enquiries that met all five of Nikhil's criteria and were handed to a designer." />
              <Fig label="Declined" value={c.notQualified} def="Enquiries that clearly failed one or more criteria and were closed politely without a designer handoff." />
              <Fig label="Qualified rate" value={pct(c.qualifiedRate.value)} sub={`${c.qualifiedRate.numerator} of ${c.qualifiedRate.denominator} decided, ${c.qualificationExcluded} undecided excluded`} def="Qualified ÷ (qualified + declined). Calls still in review, incomplete or missed are excluded rather than counted as passes or fails." na={c.qualifiedRate.value === null} />
              <Fig label="Need a person" value={c.humanReviewOpen} def="Open follow-ups: unclear or incomplete calls, edge cases the rules can't settle, missed calls, and urgent complaints." />
              <Fig label="Urgent complaints" value={c.urgent} def="Existing clients reporting a problem with an ongoing project. These skip sales qualification." />
            </dl>
            <p className="small muted" style={{ marginTop: 10 }}>
              <Link href="/attention">See what needs attention</Link> or <Link href="/enquiries">browse all enquiries</Link>.
            </p>
          </section>

          <div className="grid g2">
            <section className="panel" aria-labelledby="handoff-h">
              <h2 id="handoff-h">Designer handoffs on Telegram</h2>
              <dl className="figs">
                <Fig label="Delivery success" value={pct(o.handoff.successRate.value)} sub={`${o.handoff.sent} sent of ${o.handoff.successRate.denominator} attempted`} def="Handoffs and urgent escalations Telegram confirmed as delivered ÷ deliveries attempted (sent + failed). One per enquiry; retries don't inflate the count." na={o.handoff.successRate.value === null} />
                <Fig label="Failed" value={o.handoff.failed} sub="retry from the enquiry page" def="Delivery attempts that failed after bounded retries. The enquiry is kept and can be resent." />
                <Fig label="Not sent: Telegram off" value={o.handoff.unavailable} def="Handoffs that couldn't be attempted because the Telegram bot isn't configured. Shown in the dashboard instead." />
                {p.includeDemo ? <Fig label="Simulated" value={o.handoff.simulated} def="Demo handoffs. Previewed, never actually sent." /> : null}
              </dl>
            </section>

            <section className="panel" aria-labelledby="cost-h">
              <h2 id="cost-h">What it costs to run</h2>
              <dl className="figs">
                <Fig label="Actual costs" value={o.costs.actualLines ? inr(o.costs.actual) : "None recorded"} na={!o.costs.actualLines} sub="invoices / provider-reported" def="Costs the provider reported or an admin entered from an invoice. Never mixed with estimates." />
                <Fig label="Estimated call costs" value={o.costs.estimatedLines ? inr(o.costs.estimated) : "Unknown"} na={!o.costs.estimatedLines} sub={o.costs.unknownCount ? `${o.costs.unknownCount} cost lines unknown` : "all calls costed"} def="Billable minutes × the per-minute rate entered in Settings, with its source. Calls without a configured rate are unknown, not ₹0." />
                <Fig label="Est. cost per qualified lead" value={inr(o.costs.estimatedCostPerQualifiedLead)} sub={o.costs.callsWithUnknownCost ? `N/A until ${o.costs.callsWithUnknownCost} calls have a rate` : undefined} def="Estimated call costs ÷ qualified enquiries in the same period. N/A if there are no qualified leads or any call cost is unknown." na={o.costs.estimatedCostPerQualifiedLead === null} />
                <Fig label="Est. cost per call" value={inr(o.costs.estimatedCostPerCall)} def="Estimated call costs ÷ incoming calls. N/A if any call cost is unknown." na={o.costs.estimatedCostPerCall === null} />
              </dl>
              <p className="small muted" style={{ marginTop: 10 }}>
                <Link href="/costs">Cost breakdown</Link>
              </p>
            </section>
          </div>

          <section className="panel" aria-labelledby="out-h">
            <h2 id="out-h">What it&apos;s generating</h2>
            <p className="small muted">Outcomes appear only once staff record them on an enquiry. Nothing here is estimated from the average project value.</p>
            <dl className="figs">
              <Fig label="Consultations requested" value={o.outcomes.consultationsRequested} sub="asked for on the call" def="Qualified callers who asked for a consultation. The agent never books; staff confirm the time." />
              <Fig label="Consultations booked" value={o.outcomes.consultationsBooked + o.outcomes.consultationsHeld} sub="confirmed by staff" def="Enquiries a staff member marked as booked or held." />
              <Fig label="Conversion rate" value={o.outcomes.converted + o.outcomes.lost ? pct(o.outcomes.conversionRate.value) : "Not yet recorded"} sub={`${o.outcomes.converted} won, ${o.outcomes.lost} lost`} def="Converted ÷ enquiries with a recorded won/lost outcome, for enquiries that arrived in this period. Qualified is not the same as converted." na={o.outcomes.conversionRate.value === null} />
              <Fig label="Project value won" value={o.outcomes.revenueInfluencedInr === null ? "Not yet recorded" : inr(o.outcomes.revenueInfluencedInr, 0)} sub={o.outcomes.convertedWithoutValue ? `${o.outcomes.convertedWithoutValue} wins without a value` : undefined} def="Sum of project values staff recorded on converted enquiries. Never estimated from the ₹8–14 lakh average." na={o.outcomes.revenueInfluencedInr === null} />
            </dl>
          </section>
        </div>
      )}
    </>
  );
}
