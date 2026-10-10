import { describe, expect, it } from "vitest";
import { callMetrics, costMetrics, handoffMetrics, median, ratio, responseMetrics, type EnquiryLike } from "@/lib/analytics/metrics";
import { loadConfig, integrationStatus } from "@/lib/config/env";
import { billableMinutes } from "@/lib/costs/service";
import { assertNoPriceLeak } from "@/lib/notifications/format";
import { sendTelegramMessage } from "@/lib/notifications/telegram";
import { computeSignature, mapStatus, VaaniYantraAdapter } from "@/lib/voice-provider/vaaniyantra";

const cfg = { VAANIYANTRA_WEBHOOK_SECRET: "whsec_x", VAANIYANTRA_API_KEY: "ck_live_x", VAANIYANTRA_API_BASE_URL: "https://vaaniyantra.com/api/v1", VAANIYANTRA_AGENT_ID: undefined, WEBHOOK_MAX_AGE_SECONDS: 86400 };
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });

describe("VaaniYantra adapter", () => {
  it("verifies sha256=HMAC(raw body) with constant-time comparison", () => {
    const a = new VaaniYantraAdapter(cfg);
    const body = '{"event":"call.completed"}';
    expect(a.verify(body, new Headers({ "x-vaaniyantra-signature": computeSignature(body, "whsec_x") }))).toEqual({ ok: true });
    expect(a.verify(body + " ", new Headers({ "x-vaaniyantra-signature": computeSignature(body, "whsec_x") })).ok).toBe(false);
    expect(a.verify(body, new Headers({ "x-vaaniyantra-signature": "sha256=short" })).ok).toBe(false);
  });

  it("maps documented statuses conservatively", () => {
    expect(mapStatus("call.completed", "COMPLETED")).toBe("COMPLETED");
    expect(mapStatus("call.failed", "NO_ANSWER")).toBe("MISSED");
    expect(mapStatus("call.failed", "FAILED")).toBe("FAILED");
    expect(mapStatus("call.failed", "SOMETHING_NEW")).toBe("FAILED");
  });

  it("enriches with transcript + startedAt from GET /calls/:id, retrying a 429", async () => {
    let n = 0;
    const seen: string[] = [];
    const f: typeof fetch = async (url, init) => {
      seen.push(`${url} ${(init!.headers as Record<string, string>).Authorization}`);
      n++;
      if (n === 1) return json({ error: "slow down" }, 429, { "retry-after": "1" });
      return json({ call: { id: "c1", startedAt: "2026-10-10T10:00:02Z", transcript: [{ role: "AGENT", text: "Hello", atMs: 900 }, { role: "CALLER", text: "Hi", atMs: 3000 }] } });
    };
    const a = new VaaniYantraAdapter(cfg, f);
    const out = await a.enrich({ provider: "vaaniyantra", kind: "CALL_COMPLETED", rawEventType: "call.completed", dedupeKey: "k", providerCallId: "c1", direction: "INBOUND", callStatus: "COMPLETED", isDemo: false });
    expect(n).toBe(2);
    expect(seen[0]).toBe("https://vaaniyantra.com/api/v1/calls/c1 Bearer ck_live_x");
    expect(out.transcript).toHaveLength(2);
    expect(out.startedAt?.toISOString()).toBe("2026-10-10T10:00:02.000Z");
    expect(out.enrichment).toEqual({ attempted: true, ok: true });
  });

  it("does not retry auth failures and never throws the event away", async () => {
    let n = 0;
    const a = new VaaniYantraAdapter(cfg, async () => {
      n++;
      return json({ error: "nope" }, 401);
    });
    const out = await a.enrich({ provider: "vaaniyantra", kind: "CALL_COMPLETED", rawEventType: "call.completed", dedupeKey: "k", providerCallId: "c1", direction: "INBOUND", callStatus: "COMPLETED", isDemo: false });
    expect(n).toBe(1);
    expect(out.enrichment?.ok).toBe(false);
    expect(out.enrichment?.error).toMatch(/AUTH/);
  });

  it("handles timeouts and malformed provider responses", async () => {
    const timeout = new VaaniYantraAdapter(cfg, async () => {
      const e = new Error("t");
      e.name = "TimeoutError";
      throw e;
    });
    const base = { provider: "vaaniyantra", kind: "CALL_COMPLETED" as const, rawEventType: "call.completed", dedupeKey: "k", providerCallId: "c1", direction: "INBOUND" as const, callStatus: "COMPLETED" as const, isDemo: false };
    expect((await timeout.enrich(base)).enrichment?.error).toMatch(/TIMEOUT/);
    const weird = new VaaniYantraAdapter(cfg, async () => json({ unexpected: true }));
    expect((await weird.enrich(base)).enrichment?.error).toMatch(/BAD_RESPONSE/);
  });
});

describe("Telegram adapter", () => {
  it("returns NOT_CONFIGURED without credentials (no network call)", async () => {
    expect(await sendTelegramMessage({ apiBase: "https://api.telegram.org" }, undefined, "x")).toMatchObject({ ok: false, category: "NOT_CONFIGURED", attempts: 0 });
  });
  it("honours 429 retry_after then succeeds", async () => {
    let n = 0;
    const r = await sendTelegramMessage({ token: "t", apiBase: "https://api.telegram.org" }, "1", "hi", async () => (++n === 1 ? json({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 1 } }, 429) : json({ ok: true, result: { message_id: 5 } })));
    expect(r).toEqual({ ok: true, messageId: "5", attempts: 2 });
  });
  it("treats network errors as transient and gives up after 3 attempts", async () => {
    let n = 0;
    const r = await sendTelegramMessage({ token: "SECRET", apiBase: "https://api.telegram.org" }, "1", "hi", async () => {
      n++;
      throw new TypeError("fetch failed https://api.telegram.org/botSECRET/sendMessage");
    });
    expect(n).toBe(3);
    expect(r).toMatchObject({ ok: false, category: "NETWORK" });
    expect(JSON.stringify(r)).not.toMatch(/SECRET/);
  });
  it("blocks any outgoing message that contains a price", () => {
    expect(() => assertNoPriceLeak("Scope: kitchen. Rates start at ₹1,800 per sq ft")).toThrow(/pricing guardrail/);
  });
});

describe("configuration", () => {
  it("starts in mock mode without any provider credentials and warns clearly", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x", SESSION_SECRET: "x".repeat(40) } as unknown as NodeJS.ProcessEnv);
    const s = integrationStatus(c);
    expect(s.voiceMode).toBe("MOCK");
    expect(s.telegram.configured).toBe(false);
    expect(s.warnings.join(" ")).toMatch(/MOCK mode/);
  });
  it("flags vaaniyantra mode without a webhook secret as MISCONFIGURED", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://x", SESSION_SECRET: "x".repeat(40), VOICE_PROVIDER: "vaaniyantra" } as unknown as NodeJS.ProcessEnv);
    expect(integrationStatus(c).voiceMode).toBe("MISCONFIGURED");
  });
  it("rejects a missing database URL or short session secret with a clear message", () => {
    expect(() => loadConfig({ SESSION_SECRET: "x".repeat(40) } as unknown as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ DATABASE_URL: "postgres://x", SESSION_SECRET: "short" } as unknown as NodeJS.ProcessEnv)).toThrow(/SESSION_SECRET/);
  });
});

describe("metric formulas", () => {
  const row = (o: Partial<EnquiryLike>): EnquiryLike => ({ callStatus: "COMPLETED", disposition: "QUALIFIED", humanReviewStatus: "NONE", priority: "NORMAL", callArrivedAt: new Date(0), firstResponseAt: new Date(2000), consultationStatus: "NOT_REQUESTED", conversionStatus: "UNKNOWN", projectValueInr: null, ...o });
  it("ratio returns null (N/A) for zero denominators", () => expect(ratio(0, 0).value).toBeNull());
  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("qualified rate excludes unknown outcomes and reports them", () => {
    const m = callMetrics([row({}), row({ disposition: "NOT_QUALIFIED" }), row({ disposition: "INCOMPLETE" }), row({ disposition: "HUMAN_REVIEW" })]);
    expect(m.qualifiedRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(m.qualificationExcluded).toBe(2);
  });
  it("five-minute compliance: missed calls are measured non-responses; missing timestamps are excluded", () => {
    const r = responseMetrics([row({}), row({ firstResponseAt: new Date(6 * 60_000) }), row({ callStatus: "MISSED", disposition: "MISSED", firstResponseAt: null }), row({ firstResponseAt: null }), row({ callArrivedAt: null })]);
    expect(r.withinFiveMinutes).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(r.unmeasurable).toBe(2);
    expect(r.medianFirstResponseSec).toBe(181);
  });
  it("handoff success counts only attempted deliveries; unavailable is reported separately", () => {
    const h = handoffMetrics([{ category: "QUALIFIED_HANDOFF", status: "SENT" }, { category: "QUALIFIED_HANDOFF", status: "FAILED" }, { category: "URGENT_ESCALATION", status: "UNAVAILABLE" }, { category: "MISSED_CALL", status: "SENT" }]);
    expect(h.successRate).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(h.unavailable).toBe(1);
  });
  it("an unknown cost is never treated as zero", () => {
    const calls = callMetrics([row({}), row({})]);
    const c = costMetrics(
      [
        { valueType: "ESTIMATED", amount: "10", provider: "vaaniyantra", category: "voice_minute", enquiryId: "a" },
        { valueType: "UNKNOWN", amount: null, provider: "vaaniyantra", category: "voice_minute", enquiryId: "b" },
      ],
      calls,
      0,
    );
    expect(c.estimated).toBe(10);
    expect(c.unknownCount).toBe(1);
    expect(c.estimatedCostPerQualifiedLead).toBeNull();
    expect(c.estimatedCostPerConversion).toBeNull();
  });
  it("billable minutes: exact or rounded up", () => {
    expect(billableMinutes(90, "minute")).toBe(1.5);
    expect(billableMinutes(61, "minute_rounded_up")).toBe(2);
  });
});
