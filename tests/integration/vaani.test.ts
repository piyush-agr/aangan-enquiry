import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/webhooks/vaani/route";
import { addRate } from "@/lib/costs/service";
import { db } from "@/lib/db/client";
import { callEvents, costRecords, enquiries, users } from "@/lib/db/schema";
import { drainPendingJobs } from "@/lib/http/after-response";
import { parseVaani, parseVaaniTranscript, stampsAreOffsets, vaaniSignature, verifyVaani } from "@/lib/voice-provider/vaani";
import { closeDb, setEnv, setupDb, truncateAll } from "./helpers";

const SECRET = "vaani_test_signing_secret";
const ROOM = "inbound-1791650000-abc123";

const transcript = [
  "[00:00:01] AGENT: Hello, you've reached Aangan Studio. I'm the studio's virtual assistant. How can I help you today?",
  "[00:00:07] USER: Hi, I'm Priya. We have a 3BHK in Kothrud and want to redo the whole thing — kitchen, living room, both bedrooms. About 1,400 sq ft.",
  "[00:00:20] AGENT: When would you need the project complete?",
  "[00:00:24] USER: We'd like to be done by March. We're in no rush. Yes, I'm the owner.",
  "[00:00:31] AGENT: Would you like one of our designers to contact you to arrange a consultation?",
  "[00:00:35] USER: Yes please.",
].join("\n\n");

const post = (data: Record<string, unknown> = {}) => ({
  event: "call_postprocessing",
  call_id: ROOM,
  timestamp: new Date().toISOString(),
  data: { room_name: ROOM, call_id: ROOM, call_duration: 41_000, end_reason: "Call ended", summary: "Caller wants full redesign, budget mentioned ₹20 lakh", entities: { name: "Priya", property_location: "Kothrud" }, dispositions: { qualified: "yes" }, recording_url: null, transcript, ...data },
});

function signedReq(obj: unknown, opts: { key?: string; ts?: number; badSig?: boolean } = {}) {
  const body = JSON.stringify(obj);
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.key) {
    headers["x-vaani-timestamp"] = ts;
    headers["x-vaani-signature"] = opts.badSig ? "sha256=" + "0".repeat(64) : vaaniSignature(SECRET, ts, body);
  }
  const url = `http://localhost/api/webhooks/vaani${opts.key ? `?key=${encodeURIComponent(opts.key)}` : ""}`;
  return new Request(url, { method: "POST", body, headers });
}

beforeAll(setupDb);
beforeEach(async () => {
  await truncateAll();
  setEnv({ VOICE_PROVIDER: "vaani", VAANI_WEBHOOK_SECRET: SECRET, VAANI_API_KEY: "" });
});
afterAll(async () => {
  setEnv({ VOICE_PROVIDER: "mock" });
  await closeDb();
});

describe("Vaani AI parsing and verification (docs.vaanivoice.ai)", () => {
  it("parses the [HH:MM:SS] AGENT/USER transcript into turns with offsets", () => {
    const { turns, stamps } = parseVaaniTranscript(transcript);
    expect(turns).toHaveLength(6);
    expect(turns[0]).toMatchObject({ role: "AGENT", atMs: 1000 });
    expect(turns[1]!.role).toBe("CALLER");
    expect(stampsAreOffsets(stamps)).toBe(true);
    expect(stampsAreOffsets([45000, 45010])).toBe(false); // wall-clock stamps are not offsets
  });

  it("verifies HMAC-SHA256 over '<timestamp>.<body>' and enforces the 300 s window", () => {
    const body = '{"event":"call_started"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const cfg = { VAANI_API_BASE_URL: "https://api.vaanivoice.ai", VAANI_WEBHOOK_SECRET: SECRET };
    const h = (sig: string, t = ts) => new Headers({ "x-vaani-signature": sig, "x-vaani-timestamp": t });
    const u = new URL("http://x/api/webhooks/vaani");
    expect(verifyVaani(cfg, body, h(vaaniSignature(SECRET, ts, body)), u)).toEqual({ ok: true, method: "signature" });
    expect(verifyVaani(cfg, body + " ", h(vaaniSignature(SECRET, ts, body)), u).ok).toBe(false);
    const old = String(Number(ts) - 400);
    expect(verifyVaani(cfg, body, h(vaaniSignature(SECRET, old, body), old), u).ok).toBe(false);
    expect(verifyVaani({ ...cfg, VAANI_WEBHOOK_SECRET: undefined }, body, h("x"), u).ok).toBe(false);
  });

  it("ignores outbound-only events and outbound rooms", () => {
    expect(parseVaani(JSON.stringify({ event: "call_no_answer", room_name: "outbound-1-x", status: "no_answer" })).kind).toBe("ignore");
    expect(parseVaani(JSON.stringify({ event: "call_started", room_name: "outbound-1-x", status: "dialing" })).kind).toBe("ignore");
    expect(parseVaani(JSON.stringify(post({ room_name: "outbound-9-z" }))).kind).toBe("ignore");
  });
});

describe("Vaani AI webhook endpoint", () => {
  it("full inbound call: call_started → call_ended → call_postprocessing → qualified enquiry with number, timing and handoff", async () => {
    expect((await POST(signedReq({ event: "call_started", room_name: ROOM, status: "dialing", phone_number: "+919800001111" }))).status).toBe(200);
    expect((await POST(signedReq({ event: "user_picked_up_at", room_name: ROOM, status: "active" }))).status).toBe(200);
    expect((await POST(signedReq({ event: "call_ended", room_name: ROOM, call_duration: 41.2, end_reason: "USER_DISCONNECT" }))).status).toBe(200);
    const res = await POST(signedReq(post()));
    expect(res.status).toBe(200);
    await drainPendingJobs();

    const [e] = await db().select().from(enquiries).where(eq(enquiries.providerCallId, ROOM));
    expect(e!.provider).toBe("vaani");
    expect(e!.disposition).toBe("QUALIFIED");
    expect(e!.callerPhone).toBe("+919800001111");
    expect(e!.callerPhoneVerified).toBe(true);
    expect(e!.locality).toMatch(/Kothrud/);
    expect(e!.durationSec).toBe(41);
    expect(e!.firstResponseMethod).toMatch(/call_started receipt \+ first AGENT transcript offset/);
    expect(e!.firstResponseAt!.getTime() - e!.callArrivedAt!.getTime()).toBe(1000);
    expect(e!.providerSummary).not.toMatch(/20 lakh/); // price-looking text redacted from provider summary
    expect(e!.notificationStatus).toBe("UNAVAILABLE"); // Telegram not configured in this test
  });

  it("accepts the ?key= URL token when signature headers are absent, and rejects a wrong key", async () => {
    expect((await POST(signedReq(post(), { key: SECRET }))).status).toBe(200);
    expect((await POST(signedReq(post({ room_name: "inbound-2" }), { key: "wrong" }))).status).toBe(401);
    expect((await POST(signedReq(post({ room_name: "inbound-3" }), { badSig: true }))).status).toBe(401);
  });

  it("is idempotent under Vaani's retries (same event delivered twice)", async () => {
    await POST(signedReq(post()));
    await drainPendingJobs();
    const again = await POST(signedReq(post()));
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    await drainPendingJobs();
    expect(await db().select().from(enquiries)).toHaveLength(1);
    const timing1 = await POST(signedReq({ event: "call_started", room_name: "inbound-x", phone_number: "+91" }));
    const timing2 = await POST(signedReq({ event: "call_started", room_name: "inbound-x", phone_number: "+91" }));
    expect(await timing1.json()).toMatchObject({ duplicate: false });
    expect(await timing2.json()).toMatchObject({ duplicate: true });
  });

  it("rejects malformed JSON and invalid postprocessing payloads", async () => {
    const bad = "{not json";
    const ts = String(Math.floor(Date.now() / 1000));
    const r = new Request("http://localhost/api/webhooks/vaani", { method: "POST", body: bad, headers: { "x-vaani-timestamp": ts, "x-vaani-signature": vaaniSignature(SECRET, ts, bad) } });
    expect((await POST(r)).status).toBe(400);
    expect((await POST(signedReq({ event: "call_postprocessing", data: {} }))).status).toBe(400);
  });

  it("records provider-reported credits; ₹ value is estimated only with a configured rate, unknown otherwise", async () => {
    setEnv({ VAANI_API_KEY: "vaani_test_key" });
    const [admin] = await db().insert(users).values({ email: "a@t.dev", name: "A", passwordHash: "x", role: "ADMIN" }).returning();
    await addRate(db(), { provider: "vaani", category: "credit", unit: "credit", rate: 2, currency: "INR", source: "test ₹/credit", userId: admin!.id });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.vaanivoice.ai/api/call-history?page=1&page_size=100");
      expect((init!.headers as Record<string, string>)["X-API-Key"]).toBe("vaani_test_key");
      return new Response(JSON.stringify([{ call_id: ROOM, from_number: "+919800002222", direction: "Inbound", call_cost: 2.3, agent_id: "agt" }]), { status: 200 });
    }) as typeof fetch;
    try {
      await POST(signedReq(post()));
      await drainPendingJobs();
    } finally {
      globalThis.fetch = realFetch;
    }
    const [e] = await db().select().from(enquiries);
    expect(e!.callerPhone).toBe("+919800002222"); // from call history (no call_started received)
    const [c] = await db().select().from(costRecords).where(eq(costRecords.enquiryId, e!.id));
    expect(c!.category).toBe("voice_call_credits");
    expect(Number(c!.quantity)).toBe(2.3);
    expect(c!.valueType).toBe("ESTIMATED");
    expect(Number(c!.amount)).toBeCloseTo(4.6, 4);
    const [ev] = await db().select().from(callEvents).where(eq(callEvents.eventType, "call_postprocessing"));
    expect(ev!.processingStatus).toBe("PROCESSED");
  });

  it("answers 503 when Vaani AI is not the active provider", async () => {
    setEnv({ VOICE_PROVIDER: "mock" });
    expect((await POST(signedReq(post()))).status).toBe(503);
  });
});
