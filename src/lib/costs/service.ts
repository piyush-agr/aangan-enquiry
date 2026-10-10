import { and, eq } from "drizzle-orm";
import { audit, SYSTEM } from "@/lib/audit";
import type { DB } from "@/lib/db/client";
import { costRates, costRecords, type CostRate } from "@/lib/db/schema";

/**
 * Cost methodology (see docs/costs.md):
 *  - ACTUAL: a figure the provider reported for this call (VaaniYantra's public API does not expose one
 *    today) or an invoice amount an operator entered from the provider's billing page.
 *  - ESTIMATED: billable minutes × a unit rate an operator entered, with its source recorded.
 *  - UNKNOWN: no rate is configured. amount stays NULL — an unknown cost is never shown as ₹0.
 *
 * No provider prices are hard-coded anywhere in this application.
 */

export const PER_MINUTE_CATEGORIES = ["voice_minute", "telephony_minute"] as const;
export const COST_UNITS = ["minute", "minute_rounded_up", "credit", "month"] as const;

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export function billableMinutes(durationSec: number, unit: string): number {
  const exact = durationSec / 60;
  return unit === "minute_rounded_up" ? Math.ceil(exact) : Math.round(exact * 10_000) / 10_000;
}

export interface CallCostInput {
  enquiryId: string;
  providerCallId: string;
  provider: string;
  durationSec?: number | null;
  providerCost?: { amount: number; currency: string };
  providerUsage?: { credits: number };
  incurredAt: Date;
  isDemo: boolean;
}

export async function activeRates(tx: Tx | DB): Promise<CostRate[]> {
  return tx.select().from(costRates).where(eq(costRates.active, true));
}

/** Idempotent per (enquiry, provider, category) — re-processing an event recalculates in place. */
export async function recordCallCosts(tx: Tx, input: CallCostInput) {
  const rates = await activeRates(tx);
  const rows: (typeof costRecords.$inferInsert)[] = [];

  if (input.providerCost) {
    rows.push({
      enquiryId: input.enquiryId,
      providerCallId: input.providerCallId,
      provider: input.provider,
      category: "voice_call_reported",
      quantity: "1",
      unit: "call",
      rateSource: "provider-reported",
      currency: input.providerCost.currency,
      amount: String(input.providerCost.amount),
      valueType: "ACTUAL",
      isDemo: input.isDemo,
      incurredAt: input.incurredAt,
    });
  } else if (input.providerUsage) {
    // Vaani AI reports usage in credits (call-history `call_cost`). The credit count is provider-reported;
    // its ₹ value is ESTIMATED from an admin-entered ₹-per-credit rate, or UNKNOWN without one.
    const r = rates.find((x) => x.category === "credit" && x.provider === input.provider);
    const credits = input.providerUsage.credits;
    rows.push({
      enquiryId: input.enquiryId,
      providerCallId: input.providerCallId,
      provider: input.provider,
      category: "voice_call_credits",
      quantity: String(credits),
      unit: "credit",
      rateSource: r ? `provider-reported ${credits} credits × ${r.source}` : `provider-reported ${credits} credits; no ₹-per-credit rate configured`,
      rateValue: r?.rate ?? null,
      currency: r?.currency ?? "INR",
      amount: r ? (credits * Number(r.rate)).toFixed(4) : null,
      valueType: r ? "ESTIMATED" : "UNKNOWN",
      isDemo: input.isDemo,
      incurredAt: input.incurredAt,
    });
  } else {
    // Demo calls are costed at the configured VaaniYantra rate (if any) so the cost view can be exercised,
    // and stay flagged isDemo so they never enter production totals.
    const lookup = input.provider === "mock" ? "vaaniyantra" : input.provider;
    const voiceRate = rates.find((r) => r.category === "voice_minute" && r.provider === lookup);
    const row = minuteRow(input, "voice_minute", input.provider, voiceRate);
    if (input.provider === "mock" && voiceRate) row.rateSource = `DEMO estimate using vaaniyantra rate — ${voiceRate.source}`;
    rows.push(row);
  }
  // Telephony carrier minutes (Twilio / Plivo / Exotel …) are billed separately from the voice platform.
  for (const r of rates.filter((x) => x.category === "telephony_minute")) rows.push(minuteRow(input, "telephony_minute", r.provider, r));

  for (const row of rows) {
    await tx
      .insert(costRecords)
      .values(row)
      .onConflictDoUpdate({
        target: [costRecords.enquiryId, costRecords.provider, costRecords.category],
        set: { quantity: row.quantity, rateSource: row.rateSource, rateValue: row.rateValue, amount: row.amount, valueType: row.valueType, calculatedAt: new Date() },
      });
  }
  await audit(tx, SYSTEM, "cost.calculated", "enquiry", input.enquiryId, { records: rows.map((r) => ({ provider: r.provider, category: r.category, valueType: r.valueType })) });
}

function minuteRow(input: CallCostInput, category: string, provider: string, rate?: CostRate): typeof costRecords.$inferInsert {
  const dur = input.durationSec ?? null;
  if (!rate || dur === null) {
    return {
      enquiryId: input.enquiryId,
      providerCallId: input.providerCallId,
      provider,
      category,
      quantity: dur === null ? null : String(billableMinutes(dur, "minute")),
      unit: "minute",
      rateSource: rate ? rate.source : "no rate configured",
      rateValue: rate?.rate ?? null,
      currency: rate?.currency ?? "INR",
      amount: null,
      valueType: "UNKNOWN",
      isDemo: input.isDemo,
      incurredAt: input.incurredAt,
    };
  }
  const minutes = billableMinutes(dur, rate.unit);
  return {
    enquiryId: input.enquiryId,
    providerCallId: input.providerCallId,
    provider,
    category,
    quantity: String(minutes),
    unit: rate.unit,
    rateSource: rate.source,
    rateValue: rate.rate,
    currency: rate.currency,
    amount: (minutes * Number(rate.rate)).toFixed(4),
    valueType: "ESTIMATED",
    isDemo: input.isDemo,
    incurredAt: input.incurredAt,
  };
}

export async function addRate(dbx: DB, input: { provider: string; category: string; unit: string; rate: number; currency: string; source: string; userId: string }) {
  return dbx.transaction(async (tx) => {
    // one active rate per provider+category
    await tx.update(costRates).set({ active: false }).where(and(eq(costRates.provider, input.provider), eq(costRates.category, input.category), eq(costRates.active, true)));
    const [row] = await tx
      .insert(costRates)
      .values({ provider: input.provider, category: input.category, unit: input.unit, rate: String(input.rate), currency: input.currency, source: input.source, createdBy: input.userId })
      .returning();
    await audit(tx, { type: "user", id: input.userId }, "settings.rate_added", "cost_rate", row!.id, { provider: input.provider, category: input.category, unit: input.unit, rate: input.rate, source: input.source });
    return row!;
  });
}

/** Operator-entered actual (e.g. the VaaniYantra monthly invoice). */
export async function addActualCost(dbx: DB, input: { provider: string; amount: number; currency: string; periodEnd: Date; note: string; userId: string }) {
  const [row] = await dbx
    .insert(costRecords)
    .values({ provider: input.provider, category: "invoice", unit: "period", quantity: "1", rateSource: `operator-entered: ${input.note}`.slice(0, 300), currency: input.currency, amount: input.amount.toFixed(4), valueType: "ACTUAL", incurredAt: input.periodEnd, isDemo: false })
    .returning();
  await audit(dbx, { type: "user", id: input.userId }, "settings.rate_added", "cost_record", row!.id, { kind: "actual-invoice", provider: input.provider, amount: input.amount });
  return row!;
}
