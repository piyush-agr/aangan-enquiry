import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/vaaniyantra/route";
import { db } from "@/lib/db/client";
import { callEvents, enquiries } from "@/lib/db/schema";
import { drainPendingJobs } from "@/lib/http/after-response";
import { computeSignature } from "@/lib/voice-provider/vaaniyantra";
import { closeDb, setEnv, setupDb, truncateAll } from "./helpers";

const SECRET = "whsec_test_secret";

function payload(over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return {
    event: "call.completed",
    timestamp: new Date().toISOString(),
    data: {
      id: "call_abc123",
      direction: "INBOUND",
      status: "COMPLETED",
      fromNumber: "+919800000001",
      toNumber: "+912000000000",
      durationSec: 240,
      language: "en-IN",
      agent: { id: "agt_1", name: "Aangan front desk" },
      summary: "Caller wants full interiors for a 3BHK in Baner, done by March. Agent said rates start at ₹1,800 per sq ft.",
      collectedData: { name: "Asha", location: "Baner" },
      createdAt: new Date(Date.now() - 300_000).toISOString(),
      endedAt: new Date(Date.now() - 60_000).toISOString(),
      ...data,
    },
    ...over,
  };
}

function req(body: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/webhooks/vaaniyantra", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });
}
function signed(obj: unknown, extra: Record<string, string> = {}) {
  const body = JSON.stringify(obj);
  return req(body, { "x-vaaniyantra-signature": computeSignature(body, SECRET), "x-vaaniyantra-event": (obj as { event: string }).event, ...extra });
}

beforeAll(setupDb);
beforeEach(async () => {
  await truncateAll();
  setEnv({ VOICE_PROVIDER: "vaaniyantra", VAANIYANTRA_WEBHOOK_SECRET: SECRET, VAANIYANTRA_API_KEY: "" });
});
afterAll(async () => {
  setEnv({ VOICE_PROVIDER: "mock" });
  await closeDb();
});

describe("VaaniYantra webhook endpoint", () => {
  it("accepts a correctly signed call.completed, records it and processes it after responding", async () => {
    const res = await POST(signed(payload()));
    expect(res.status).toBe(200);
    await drainPendingJobs();
    const [e] = await db().select().from(enquiries);
    expect(e!.provider).toBe("vaaniyantra");
    expect(e!.providerCallId).toBe("call_abc123");
    expect(e!.callerPhoneVerified).toBe(true);
    expect(e!.locality).toBe("Baner"); // from collectedData (validated)
    // without the API key there is no transcript → no measurable first response; never the webhook time
    expect(e!.firstResponseAt).toBeNull();
    // provider summary is stored with price figures redacted
    expect(e!.providerSummary).not.toMatch(/1,800/);
    const [ev] = await db().select().from(callEvents);
    expect(ev!.processingStatus).toBe("PROCESSED");
    expect(ev!.lastError).toMatch(/API key not configured/);
  });

  it("rejects a bad signature (401) and stores nothing", async () => {
    const body = JSON.stringify(payload());
    const res = await POST(req(body, { "x-vaaniyantra-signature": "sha256=" + "0".repeat(64) }));
    expect(res.status).toBe(401);
    expect(await db().select().from(callEvents)).toHaveLength(0);
  });

  it("rejects a missing signature (401)", async () => {
    expect((await POST(req(JSON.stringify(payload())))).status).toBe(401);
  });

  it("fails closed when the webhook secret is not configured", async () => {
    setEnv({ VAANIYANTRA_WEBHOOK_SECRET: "" });
    expect((await POST(signed(payload()))).status).toBe(401);
  });

  it("rejects malformed JSON and payloads missing required fields (400)", async () => {
    const bad = "{not json";
    expect((await POST(req(bad, { "x-vaaniyantra-signature": computeSignature(bad, SECRET) }))).status).toBe(400);
    expect((await POST(signed({ event: "call.completed", data: { direction: "INBOUND" } }))).status).toBe(400);
  });

  it("rejects an event-header/body mismatch and stale timestamps (replay protection)", async () => {
    expect((await POST(signed(payload(), { "x-vaaniyantra-event": "call.failed" }))).status).toBe(400);
    expect((await POST(signed(payload({ timestamp: new Date(Date.now() - 3 * 86400000).toISOString() })))).status).toBe(400);
  });

  it("rejects oversized payloads (413)", async () => {
    const huge = payload({}, { summary: "x".repeat(300 * 1024) });
    expect((await POST(signed(huge))).status).toBe(413);
  });

  it("is idempotent for repeated deliveries", async () => {
    const p = payload();
    await POST(signed(p));
    await drainPendingJobs();
    const second = await POST(signed(p));
    expect(await second.json()).toMatchObject({ ok: true, duplicate: true });
    await drainPendingJobs();
    expect(await db().select().from(enquiries)).toHaveLength(1);
  });

  it("ignores outbound calls and unsupported events (out of scope) without creating enquiries", async () => {
    expect(await (await POST(signed(payload({}, { direction: "OUTBOUND" })))).json()).toMatchObject({ ignored: expect.stringMatching(/outbound/) });
    expect(await (await POST(signed(payload({ event: "call.started" })))).json()).toMatchObject({ ignored: expect.any(String) });
    expect(await db().select().from(enquiries)).toHaveLength(0);
  });

  it("maps call.failed NO_ANSWER to a missed call with a follow-up", async () => {
    await POST(signed(payload({ event: "call.failed" }, { id: "call_missed", status: "NO_ANSWER", durationSec: 0, summary: null, collectedData: null })));
    await drainPendingJobs();
    const [e] = await db().select().from(enquiries).where(eq(enquiries.providerCallId, "call_missed"));
    expect(e!.callStatus).toBe("MISSED");
    expect(e!.disposition).toBe("MISSED");
    expect(e!.humanReviewStatus).toBe("OPEN");
  });

  it("answers 503 in mock mode (no public webhook accepted)", async () => {
    setEnv({ VOICE_PROVIDER: "mock" });
    expect((await POST(signed(payload()))).status).toBe(503);
  });
});
