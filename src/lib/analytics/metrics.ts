/**
 * Central metric definitions. The dashboard, the /api/metrics endpoint and the tests all use these
 * functions, so a formula can only change in one place. Every ratio returns its numerator and
 * denominator; a zero denominator yields `null` (rendered "N/A"), never 0 or Infinity.
 */

export interface EnquiryLike {
  callStatus: "IN_PROGRESS" | "COMPLETED" | "MISSED" | "DISCONNECTED" | "FAILED";
  disposition: "PENDING" | "QUALIFIED" | "NOT_QUALIFIED" | "INCOMPLETE" | "HUMAN_REVIEW" | "URGENT_ESCALATION" | "MISSED";
  humanReviewStatus: "NONE" | "OPEN" | "RESOLVED";
  priority: "NORMAL" | "HIGH" | "URGENT";
  callArrivedAt: Date | null;
  firstResponseAt: Date | null;
  consultationStatus: "NOT_REQUESTED" | "REQUESTED" | "BOOKED_CONFIRMED" | "HELD";
  conversionStatus: "UNKNOWN" | "CONVERTED" | "LOST";
  projectValueInr: string | null;
}
export interface NotificationLike {
  category: "QUALIFIED_HANDOFF" | "URGENT_ESCALATION" | "MISSED_CALL";
  status: "NOT_REQUIRED" | "PENDING" | "SENT" | "FAILED" | "UNAVAILABLE" | "SIMULATED";
}
export interface CostLike {
  valueType: "ACTUAL" | "ESTIMATED" | "UNKNOWN";
  amount: string | null;
  provider: string;
  category: string;
  enquiryId: string | null;
}

export interface Ratio {
  numerator: number;
  denominator: number;
  value: number | null;
}
export const ratio = (n: number, d: number): Ratio => ({ numerator: n, denominator: d, value: d > 0 ? n / d : null });

export const FIVE_MINUTES_MS = 5 * 60 * 1000;

/** Calls with a "usable outcome": completed and reached a disposition other than INCOMPLETE/PENDING. */
const HANDLED = new Set(["QUALIFIED", "NOT_QUALIFIED", "HUMAN_REVIEW", "URGENT_ESCALATION"]);

export function callMetrics(rows: EnquiryLike[]) {
  const total = rows.length; // one row per unique (provider, provider_call_id) — duplicates cannot exist
  const handled = rows.filter((r) => r.callStatus === "COMPLETED" && HANDLED.has(r.disposition)).length;
  const missed = rows.filter((r) => r.callStatus === "MISSED").length;
  const failed = rows.filter((r) => r.callStatus === "FAILED").length;
  const disconnected = rows.filter((r) => r.callStatus === "DISCONNECTED").length;
  const incomplete = rows.filter((r) => r.disposition === "INCOMPLETE").length;
  const qualified = rows.filter((r) => r.disposition === "QUALIFIED").length;
  const notQualified = rows.filter((r) => r.disposition === "NOT_QUALIFIED").length;
  const humanReviewOpen = rows.filter((r) => r.humanReviewStatus === "OPEN").length;
  const urgent = rows.filter((r) => r.disposition === "URGENT_ESCALATION").length;
  return {
    total,
    handled,
    missed,
    failed,
    disconnected,
    unansweredOrFailed: missed + failed,
    incomplete,
    qualified,
    notQualified,
    humanReviewOpen,
    urgent,
    /** Qualified ÷ (qualified + not qualified). Review/incomplete outcomes are unknown, so excluded and reported. */
    qualifiedRate: ratio(qualified, qualified + notQualified),
    qualificationExcluded: total - qualified - notQualified,
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Five-minute response compliance.
 *  start    = call arrival (provider createdAt)
 *  response = first AGENT utterance (provider startedAt + transcript offset)
 *  A missed/failed call with a known arrival time is MEASURED and NON-compliant (nobody responded).
 *  A completed call without a measurable first response is EXCLUDED and counted as unmeasurable.
 */
export function responseMetrics(rows: EnquiryLike[]) {
  const latencies: number[] = [];
  let compliant = 0;
  let measured = 0;
  let unmeasurable = 0;
  for (const r of rows) {
    if (!r.callArrivedAt) {
      unmeasurable++;
      continue;
    }
    if (r.firstResponseAt) {
      const ms = r.firstResponseAt.getTime() - r.callArrivedAt.getTime();
      if (ms < 0) {
        unmeasurable++;
        continue;
      }
      measured++;
      latencies.push(ms / 1000);
      if (ms <= FIVE_MINUTES_MS) compliant++;
    } else if (r.callStatus === "MISSED" || r.callStatus === "FAILED") {
      measured++; // known: no response at all
    } else {
      unmeasurable++;
    }
  }
  const avg = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  return { withinFiveMinutes: ratio(compliant, measured), unmeasurable, avgFirstResponseSec: avg, medianFirstResponseSec: median(latencies), respondedCount: latencies.length };
}

export function handoffMetrics(rows: NotificationLike[]) {
  const designer = rows.filter((n) => n.category === "QUALIFIED_HANDOFF" || n.category === "URGENT_ESCALATION");
  const sent = designer.filter((n) => n.status === "SENT").length;
  const failed = designer.filter((n) => n.status === "FAILED").length;
  const unavailable = designer.filter((n) => n.status === "UNAVAILABLE").length;
  const pending = designer.filter((n) => n.status === "PENDING").length;
  const simulated = designer.filter((n) => n.status === "SIMULATED").length;
  // Attempts = deliveries actually tried (sent or failed). "Unavailable" = not configured, reported separately.
  return { successRate: ratio(sent, sent + failed), sent, failed, unavailable, pending, simulated };
}

export function costMetrics(costs: CostLike[], calls: ReturnType<typeof callMetrics>, conversions: number) {
  const sum = (t: CostLike["valueType"]) => costs.filter((c) => c.valueType === t && c.amount !== null).reduce((a, c) => a + Number(c.amount), 0);
  const actual = sum("ACTUAL");
  const estimated = sum("ESTIMATED");
  const unknownCount = costs.filter((c) => c.valueType === "UNKNOWN").length;
  const callLevelEstimated = costs.filter((c) => c.valueType === "ESTIMATED" && c.enquiryId && c.amount !== null).reduce((a, c) => a + Number(c.amount), 0);
  const callsWithUnknown = new Set(costs.filter((c) => c.valueType === "UNKNOWN" && c.enquiryId).map((c) => c.enquiryId)).size;

  const byKey = (k: "provider" | "category") => {
    const m = new Map<string, { actual: number; estimated: number; unknown: number }>();
    for (const c of costs) {
      const e = m.get(c[k]) ?? { actual: 0, estimated: 0, unknown: 0 };
      if (c.valueType === "UNKNOWN") e.unknown++;
      else if (c.valueType === "ACTUAL") e.actual += Number(c.amount ?? 0);
      else e.estimated += Number(c.amount ?? 0);
      m.set(c[k], e);
    }
    return [...m.entries()].map(([key, v]) => ({ key, ...v }));
  };

  const per = (n: number) => (n > 0 && callsWithUnknown === 0 ? callLevelEstimated / n : null);
  return {
    actual,
    estimated,
    actualLines: costs.filter((c) => c.valueType === "ACTUAL").length,
    estimatedLines: costs.filter((c) => c.valueType === "ESTIMATED").length,
    unknownCount,
    callsWithUnknownCost: callsWithUnknown,
    /** Estimated per-call cost ÷ calls. null if any call's cost is unknown (an unknown is never treated as zero). */
    estimatedCostPerCall: per(calls.total),
    estimatedCostPerHandledCall: per(calls.handled),
    estimatedCostPerQualifiedLead: per(calls.qualified),
    estimatedCostPerConversion: per(conversions),
    /** Operator-entered / provider-reported actuals ÷ qualified leads in the same period. */
    actualCostPerQualifiedLead: actual > 0 && calls.qualified > 0 ? actual / calls.qualified : null,
    byProvider: byKey("provider"),
    byCategory: byKey("category"),
  };
}

export function outcomeMetrics(rows: EnquiryLike[]) {
  const consultationsRequested = rows.filter((r) => r.consultationStatus === "REQUESTED").length;
  const consultationsBooked = rows.filter((r) => r.consultationStatus === "BOOKED_CONFIRMED").length;
  const consultationsHeld = rows.filter((r) => r.consultationStatus === "HELD").length;
  const converted = rows.filter((r) => r.conversionStatus === "CONVERTED");
  const lost = rows.filter((r) => r.conversionStatus === "LOST").length;
  const valued = converted.filter((r) => r.projectValueInr !== null);
  return {
    consultationsRequested,
    consultationsBooked,
    consultationsHeld,
    converted: converted.length,
    lost,
    /** Converted ÷ enquiries with a recorded conversion outcome (cohort = enquiries arriving in the period). */
    conversionRate: ratio(converted.length, converted.length + lost),
    /** Only from recorded project values on converted enquiries. Never estimated from averages. */
    revenueInfluencedInr: valued.length ? valued.reduce((a, r) => a + Number(r.projectValueInr), 0) : null,
    convertedWithoutValue: converted.length - valued.length,
  };
}
