import { NextResponse } from "next/server";
import { runAfterResponse } from "@/lib/http/after-response";
import { config } from "@/lib/config/env";
import { clientIp, rateLimit } from "@/lib/http/rate-limit";
import { markFailed, processEvent, receiveEvent, recordRejectedEvent } from "@/lib/telephony-events/ingest";
import { VaaniYantraAdapter } from "@/lib/voice-provider/vaaniyantra";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 256 * 1024;

/**
 * VaaniYantra webhook receiver. VaaniYantra waits at most 6 s, so this handler only verifies, validates
 * and durably records the event, answers 200, and processes it after the response (Next.js `after`).
 * If post-response processing fails, the event stays FAILED/PENDING and /api/jobs/reprocess retries it.
 */
export async function POST(req: Request) {
  const cfg = config();
  if (cfg.VOICE_PROVIDER !== "vaaniyantra") return NextResponse.json({ error: "voice provider is in mock mode" }, { status: 503 });

  const rl = rateLimit(`wh:${clientIp(req)}`, 240, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  const adapter = new VaaniYantraAdapter(cfg);
  const v = adapter.verify(raw, req.headers);
  if (!v.ok) {
    await recordRejectedEvent(adapter.id, v.reason, { ip: clientIp(req) });
    return NextResponse.json({ error: "unauthorized" }, { status: v.status });
  }
  const parsed = adapter.parse(raw, req.headers);
  if (parsed.ok === false) {
    await recordRejectedEvent(adapter.id, parsed.reason);
    return NextResponse.json({ error: "invalid event", reason: parsed.reason }, { status: 400 });
  }
  if (parsed.ok === "ignore") return NextResponse.json({ ok: true, ignored: parsed.reason });

  let received;
  try {
    received = await receiveEvent(parsed.event);
  } catch {
    // Database unavailable: answer 503 so the provider can redeliver (if it retries — not documented).
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
  if (received.alreadyProcessed) return NextResponse.json({ ok: true, duplicate: true });

  runAfterResponse(async () => {
    try {
      await processEvent(received.eventId, (e) => adapter.enrich(e));
    } catch {
      await markFailed(received.eventId, "post-response processing crashed").catch(() => undefined);
    }
  });
  return NextResponse.json({ ok: true, eventId: received.eventId, duplicate: received.duplicate });
}
