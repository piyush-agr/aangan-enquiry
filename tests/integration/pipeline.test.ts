import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { overview } from "@/lib/analytics/queries";
import { runScript } from "@/lib/conversation/agent";
import { SCENARIOS } from "@/lib/conversation/scenarios";
import { addRate } from "@/lib/costs/service";
import { db } from "@/lib/db/client";
import { auditEvents, callEvents, costRecords, enquiries, notifications, qualificationAssessments, users } from "@/lib/db/schema";
import { retryNotification } from "@/lib/notifications/service";
import { APPROVED_PRICING_RESPONSE } from "@/lib/pricing-guardrails";
import { ingest } from "@/lib/telephony-events/ingest";
import { simulatedCallEvent } from "@/lib/voice-provider/mock";
import type { NormalisedCallEvent } from "@/lib/voice-provider/types";
import { closeDb, setEnv, setupDb, truncateAll } from "./helpers";

const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;

function eventFor(id: string, opts: { demo?: boolean; callId?: string; startedAt?: Date } = {}): NormalisedCallEvent {
  const s = scenario(id);
  const started = opts.startedAt ?? new Date();
  const { state } = runScript(s.lines, started);
  const ev = simulatedCallEvent({ state: s.outcome === "MISSED" ? undefined : state, outcome: s.outcome, callerPhone: s.callerPhone, callId: opts.callId, startedAt: started, simulateProviderFailure: s.inject?.providerFailure });
  if (opts.demo === false) {
    // Treat as a production-style event from a real provider for pipeline tests.
    return { ...ev, provider: "vaaniyantra", isDemo: false, dedupeKey: ev.dedupeKey.replace(/^mock/, "vaaniyantra") };
  }
  return ev;
}

async function enquiryById(id: string) {
  const [e] = await db().select().from(enquiries).where(eq(enquiries.id, id));
  return e!;
}

beforeAll(setupDb);
beforeEach(async () => {
  await truncateAll();
  setEnv({ TELEGRAM_BOT_TOKEN: "", TELEGRAM_DESIGNER_CHAT_ID: "", TELEGRAM_SEND_DEMO: "false" });
});
afterAll(closeDb);

describe("end-to-end pipeline (simulated call → enquiry → qualification → handoff → cost)", () => {
  it("qualified demo call: persisted, assessed, SIMULATED handoff, UNKNOWN cost (no rate)", async () => {
    const r = await ingest(eventFor("qualified-kothrud"));
    expect(r.status).toBe("PROCESSED");
    const e = await enquiryById(r.enquiryId!);
    expect(e.isDemo).toBe(true);
    expect(e.disposition).toBe("QUALIFIED");
    expect(e.locality).toMatch(/Kothrud/);
    expect(e.consultationStatus).toBe("REQUESTED"); // never BOOKED_CONFIRMED automatically
    expect(e.firstResponseMethod).toBe("simulated");
    const qa = await db().select().from(qualificationAssessments).where(eq(qualificationAssessments.enquiryId, e.id));
    expect(qa).toHaveLength(1);
    expect((qa[0]!.criteria as unknown[]).length).toBe(5);
    const n = await db().select().from(notifications).where(eq(notifications.enquiryId, e.id));
    expect(n).toHaveLength(1);
    expect(n[0]!.status).toBe("SIMULATED");
    expect(n[0]!.messagePreview).toMatch(/DEMO — SIMULATED CALL/);
    expect(n[0]!.messagePreview).not.toMatch(/₹|lakh|per sq/i);
    const c = await db().select().from(costRecords).where(eq(costRecords.enquiryId, e.id));
    expect(c[0]!.valueType).toBe("UNKNOWN");
    expect(c[0]!.amount).toBeNull(); // unknown is never zero
  });

  it("duplicate completion event creates no second enquiry and no second handoff", async () => {
    const ev = eventFor("qualified-kothrud", { callId: "dup-1" });
    const a = await ingest(ev);
    const b = await ingest(ev);
    expect(b.status).toBe("DUPLICATE");
    expect(b.enquiryId).toBe(a.enquiryId);
    expect(await db().select().from(enquiries)).toHaveLength(1);
    expect(await db().select().from(notifications)).toHaveLength(1);
    const [evRow] = await db().select().from(callEvents);
    expect(evRow!.deliveries).toBe(2);
  });

  it("unqualified lead is not forwarded to a designer", async () => {
    for (const id of ["nashik", "advice-only", "restaurant", "low-budget"]) {
      const r = await ingest(eventFor(id));
      const e = await enquiryById(r.enquiryId!);
      expect(e.disposition, id).toBe("NOT_QUALIFIED");
      expect(e.notificationStatus).toBe("NOT_REQUIRED");
    }
    expect(await db().select().from(notifications)).toHaveLength(0);
  });

  it("existing-client complaint creates an URGENT escalation, not a sales handoff", async () => {
    const r = await ingest(eventFor("complaint"));
    const e = await enquiryById(r.enquiryId!);
    expect(e.disposition).toBe("URGENT_ESCALATION");
    expect(e.priority).toBe("URGENT");
    expect(e.callerType).toBe("EXISTING_CLIENT");
    expect(e.escalationRecipient).toMatch(/Nikhil/);
    const [n] = await db().select().from(notifications).where(eq(notifications.enquiryId, e.id));
    expect(n!.category).toBe("URGENT_ESCALATION");
  });

  it("missed call: MISSED, no invented transcript, follow-up task, missed-call notice", async () => {
    const r = await ingest(eventFor("missed"));
    const e = await enquiryById(r.enquiryId!);
    expect(e.callStatus).toBe("MISSED");
    expect(e.disposition).toBe("MISSED");
    expect(e.transcript).toBeNull();
    expect(e.humanReviewStatus).toBe("OPEN");
    expect(await db().select().from(qualificationAssessments)).toHaveLength(0);
    const [n] = await db().select().from(notifications);
    expect(n!.category).toBe("MISSED_CALL");
  });

  it("disconnected call is linked (not merged) to the reconnection from the same verified number", async () => {
    const t0 = new Date(Date.now() - 10 * 60_000);
    const first = await ingest(eventFor("disconnect", { demo: false, startedAt: t0 }));
    const second = await ingest(eventFor("reconnect", { demo: false, startedAt: new Date(t0.getTime() + 2 * 60_000) }));
    const a = await enquiryById(first.enquiryId!);
    const b = await enquiryById(second.enquiryId!);
    expect(a.callStatus).toBe("DISCONNECTED");
    expect(b.disposition).toBe("QUALIFIED");
    expect(b.relatedEnquiryId).toBe(a.id);
    expect(a.humanReviewStatus).toBe("RESOLVED");
    expect(await db().select().from(enquiries)).toHaveLength(2);
  });

  it("production enquiry with Telegram not configured → UNAVAILABLE, enquiry intact", async () => {
    const r = await ingest(eventFor("qualified-kothrud", { demo: false }));
    const e = await enquiryById(r.enquiryId!);
    expect(e.notificationStatus).toBe("UNAVAILABLE");
    expect(e.disposition).toBe("QUALIFIED");
  });

  it("Telegram failure is recorded, bounded, retryable — and never loses the enquiry", async () => {
    setEnv({ TELEGRAM_BOT_TOKEN: "123:SECRET_TOKEN", TELEGRAM_DESIGNER_CHAT_ID: "-100123" });
    let calls = 0;
    const failing: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ ok: false, error_code: 502, description: "Bad Gateway" }), { status: 502 });
    };
    const r = await ingest(eventFor("qualified-kothrud", { demo: false }), undefined, { fetchImpl: failing });
    expect(calls).toBe(3); // bounded retries
    const e = await enquiryById(r.enquiryId!);
    expect(e.disposition).toBe("QUALIFIED");
    expect(e.notificationStatus).toBe("FAILED");
    const [n] = await db().select().from(notifications);
    expect(n!.status).toBe("FAILED");
    expect(n!.errorCategory).toBe("SERVER");
    expect(n!.errorDetail ?? "").not.toMatch(/SECRET_TOKEN/);

    const [admin] = await db().insert(users).values({ email: "a@test.dev", name: "A", passwordHash: "x", role: "ADMIN" }).returning();
    const ok: typeof fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
    const retry = await retryNotification(n!.id, { type: "user", id: admin!.id }, { fetchImpl: ok });
    expect("row" in retry && retry.row?.status).toBe("SENT");
    expect("row" in retry && retry.row?.providerMessageId).toBe("42");
    // a second retry of a delivered message is refused (no duplicate)
    expect(await retryNotification(n!.id, { type: "user", id: admin!.id }, { fetchImpl: ok })).toEqual({ error: "already delivered" });
    const auditRows = await db().select().from(auditEvents).where(eq(auditEvents.action, "notification.retry_requested"));
    expect(auditRows).toHaveLength(1);
  });

  it("Telegram 401 is permanent: no retries", async () => {
    setEnv({ TELEGRAM_BOT_TOKEN: "123:BAD", TELEGRAM_DESIGNER_CHAT_ID: "-100123" });
    let calls = 0;
    const unauth: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ ok: false, error_code: 401, description: "Unauthorized" }), { status: 401 });
    };
    await ingest(eventFor("qualified-kothrud", { demo: false }), undefined, { fetchImpl: unauth });
    expect(calls).toBe(1);
    const [n] = await db().select().from(notifications);
    expect(n!.errorCategory).toBe("AUTH");
  });

  it("successful Telegram handoff stores the provider message id and the structured format", async () => {
    setEnv({ TELEGRAM_BOT_TOKEN: "123:OK", TELEGRAM_DESIGNER_CHAT_ID: "-100123" });
    let sent: { chat_id: string; text: string } | undefined;
    const ok: typeof fetch = async (_u, init) => {
      sent = JSON.parse(String(init!.body));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    };
    await ingest(eventFor("qualified-kothrud", { demo: false }), undefined, { fetchImpl: ok });
    expect(sent!.chat_id).toBe("-100123");
    for (const label of ["AANGAN STUDIO — NEW QUALIFIED ENQUIRY", "Enquiry ID:", "Received at:", "Location:", "Scope:", "Timeline:", "Decision-maker status:", "Uncertainties:", "Source: Incoming phone call"]) expect(sent!.text).toContain(label);
    expect(sent!.text).not.toMatch(/transcript/i);
    expect(sent!.text).toMatch(/NOT yet booked/);
  });

  it("estimated cost uses a configured, sourced rate; unknown stays unknown", async () => {
    const [admin] = await db().insert(users).values({ email: "a@test.dev", name: "A", passwordHash: "x", role: "ADMIN" }).returning();
    await addRate(db(), { provider: "vaaniyantra", category: "voice_minute", unit: "minute", rate: 5, currency: "INR", source: "test rate", userId: admin!.id });
    const r = await ingest(eventFor("qualified-kothrud", { demo: false }));
    const [c] = await db().select().from(costRecords).where(eq(costRecords.enquiryId, r.enquiryId!));
    const e = await enquiryById(r.enquiryId!);
    expect(c!.valueType).toBe("ESTIMATED");
    expect(Number(c!.amount)).toBeCloseTo((e.durationSec! / 60) * 5, 3);
    expect(c!.rateSource).toBe("test rate");
  });

  it("voice-provider failure keeps the enquiry, flags it for review with the error visible", async () => {
    const r = await ingest(eventFor("provider-failure"));
    const e = await enquiryById(r.enquiryId!);
    expect(e.disposition).toBe("INCOMPLETE");
    expect(e.humanReviewStatus).toBe("OPEN");
    expect(e.humanReviewReason).toMatch(/Provider call detail unavailable/);
    const [ev] = await db().select().from(callEvents);
    expect(ev!.lastError).toMatch(/enrichment/);
  });

  it("an agent transcript that leaks a price is flagged as a pricing violation", async () => {
    const ev = eventFor("pricing-wakad", { demo: false });
    ev.transcript = [...ev.transcript!, { role: "AGENT", text: "Honestly it'll cost around ₹12 lakh.", atMs: 99_000 }];
    const r = await ingest(ev);
    expect((await enquiryById(r.enquiryId!)).pricingViolation).toBe(true);
    const clean = eventFor("pricing-wakad", { demo: false, callId: "clean" });
    expect(clean.transcript!.filter((t) => t.role === "AGENT").map((t) => t.text)).toContain(APPROVED_PRICING_RESPONSE);
    expect((await enquiryById((await ingest(clean)).enquiryId!)).pricingViolation).toBe(false);
  });

  it("dashboard overview counts match persisted rows and exclude demo data by default", async () => {
    for (const id of ["qualified-kothrud", "nashik", "complaint", "missed", "small-pod"]) await ingest(eventFor(id, { demo: false }));
    await ingest(eventFor("qualified-kothrud")); // demo
    const p = { from: new Date(Date.now() - 86400000), to: new Date(Date.now() + 60000), includeDemo: false };
    const o = await overview(p);
    expect(o.calls.total).toBe(5);
    expect(o.calls.qualified).toBe(1);
    expect(o.calls.notQualified).toBe(1);
    expect(o.calls.urgent).toBe(1);
    expect(o.calls.missed).toBe(1);
    expect(o.calls.qualifiedRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(o.response.withinFiveMinutes.denominator).toBe(5);
    expect(o.response.withinFiveMinutes.numerator).toBe(4); // the missed call is a measured non-response
    expect(o.costs.estimatedCostPerQualifiedLead).toBeNull(); // unknown costs → N/A, not ₹0
    const withDemo = await overview({ ...p, includeDemo: true });
    expect(withDemo.calls.total).toBe(6);
  });
});

describe("concurrency", () => {
  it("two workers processing the same event at once produce one enquiry and no failure", async () => {
    const { receiveEvent, processEvent } = await import("@/lib/telephony-events/ingest");
    const r = await receiveEvent(eventFor("qualified-kothrud", { demo: false, callId: "race-1" }));
    const [a, b] = await Promise.all([processEvent(r.eventId), processEvent(r.eventId)]);
    expect([a.status, b.status].sort()).toEqual(["IN_PROGRESS_ELSEWHERE", "PROCESSED"]);
    expect(await db().select().from(enquiries)).toHaveLength(1);
    const [ev] = await db().select().from(callEvents);
    expect(ev!.processingStatus).toBe("PROCESSED");
    expect(ev!.lastError).toBeNull();
  });
});
