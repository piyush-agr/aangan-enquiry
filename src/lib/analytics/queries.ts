import { and, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { costRecords, enquiries, notifications } from "@/lib/db/schema";
import { callMetrics, costMetrics, handoffMetrics, outcomeMetrics, responseMetrics } from "./metrics";

export interface Period {
  from: Date;
  to: Date; // exclusive
  includeDemo: boolean;
}

export function parsePeriod(sp: Record<string, string | string[] | undefined>, now = new Date()): Period {
  const get = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]) as string | undefined;
  const to = get("to") ? new Date(`${get("to")}T23:59:59.999+05:30`) : now;
  const from = get("from") ? new Date(`${get("from")}T00:00:00+05:30`) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  return {
    from: Number.isNaN(from.getTime()) ? new Date(now.getTime() - 30 * 86400000) : from,
    to: Number.isNaN(to.getTime()) ? now : to,
    includeDemo: get("demo") === "1",
  };
}

function demoFilter(p: Period, col: typeof enquiries.isDemo | typeof costRecords.isDemo): SQL | undefined {
  return p.includeDemo ? undefined : eq(col, false);
}

/** Everything on the overview, computed from persisted rows through the central metric functions. */
export async function overview(p: Period) {
  const enquiryWhere = and(gte(enquiries.callArrivedAt, p.from), lt(enquiries.callArrivedAt, p.to), demoFilter(p, enquiries.isDemo));
  const rows = await db().select().from(enquiries).where(enquiryWhere);
  const ids = rows.map((r) => r.id);
  const notes = ids.length ? await db().select({ category: notifications.category, status: notifications.status }).from(notifications).where(inArray(notifications.enquiryId, ids)) : [];
  const costs = await db()
    .select({ valueType: costRecords.valueType, amount: costRecords.amount, provider: costRecords.provider, category: costRecords.category, enquiryId: costRecords.enquiryId })
    .from(costRecords)
    .where(and(gte(costRecords.incurredAt, p.from), lt(costRecords.incurredAt, p.to), demoFilter(p, costRecords.isDemo)));

  const calls = callMetrics(rows);
  const outcomes = outcomeMetrics(rows);
  return {
    period: { from: p.from.toISOString(), to: p.to.toISOString(), includeDemo: p.includeDemo },
    calls,
    response: responseMetrics(rows),
    handoff: handoffMetrics(notes),
    costs: costMetrics(costs, calls, outcomes.converted),
    outcomes,
    demoRowsInPeriod: p.includeDemo ? rows.filter((r) => r.isDemo).length : 0,
  };
}

/** Daily call volume by disposition for the chart. */
export async function dailyVolume(p: Period) {
  const res = await db().execute(sql`
    select to_char(date_trunc('day', ${enquiries.callArrivedAt} at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as day,
           ${enquiries.disposition} as disposition, count(*)::int as n
    from ${enquiries}
    where ${enquiries.callArrivedAt} >= ${p.from} and ${enquiries.callArrivedAt} < ${p.to}
      ${p.includeDemo ? sql`` : sql`and ${enquiries.isDemo} = false`}
    group by 1, 2 order by 1`);
  return res.rows as { day: string; disposition: string; n: number }[];
}

export async function demoCount() {
  const [r] = await db().select({ n: sql<number>`count(*)::int` }).from(enquiries).where(eq(enquiries.isDemo, true));
  return r?.n ?? 0;
}

/** Calls per hour of day (IST), split into answered-with-outcome vs missed/failed — for the 24-hour ring. */
export async function hourlyArrivals(p: Period) {
  const res = await db().execute(sql`
    select extract(hour from ${enquiries.callArrivedAt} at time zone 'Asia/Kolkata')::int as hour,
           count(*) filter (where ${enquiries.callStatus} in ('MISSED','FAILED'))::int as missed,
           count(*)::int as total
    from ${enquiries}
    where ${enquiries.callArrivedAt} >= ${p.from} and ${enquiries.callArrivedAt} < ${p.to}
      ${p.includeDemo ? sql`` : sql`and ${enquiries.isDemo} = false`}
    group by 1`);
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, missed: 0 }));
  for (const r of res.rows as { hour: number; total: number; missed: number }[]) hours[r.hour] = r;
  return hours;
}

export async function attentionCount(includeDemo: boolean) {
  const [r] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(enquiries)
    .where(sql`(${enquiries.humanReviewStatus} = 'OPEN' or ${enquiries.notificationStatus} = 'FAILED') ${includeDemo ? sql`` : sql`and ${enquiries.isDemo} = false`}`);
  return r?.n ?? 0;
}
