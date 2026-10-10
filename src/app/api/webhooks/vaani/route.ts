import { NextResponse } from "next/server";
import { config } from "@/lib/config/env";
import { runAfterResponse } from "@/lib/http/after-response";
import { clientIp, rateLimit } from "@/lib/http/rate-limit";
import { markFailed, processEvent, receiveEvent, recordRejectedEvent } from "@/lib/telephony-events/ingest";
import { enrichVaani, recordVaaniTiming } from "@/lib/telephony-events/vaani-flow";
import { parseVaani, verifyVaani, VAANI_PROVIDER_ID } from "@/lib/voice-provider/vaani";

export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Vaani AI webhook (register in Vaani → Developers → Webhooks → Agent Webhook):
 *   https://<app>/api/webhooks/vaani?key=<VAANI_WEBHOOK_SECRET>
 * and set the same value as the endpoint's Signing Secret. Requests are accepted only with a valid
 * X-Vaani-Signature (HMAC over "<timestamp>.<body>", ±300 s) or the matching ?key= token.
 * Vaani retries non-2xx up to 5 times, so the response is fast and receipt is idempotent.
 */
export async function POST(req: Request) {
  const cfg = config();
  if (cfg.VOICE_PROVIDER !== "vaani") return NextResponse.json({ error: "Vaani AI is not the active voice provider" }, { status: 503 });

  const rl = rateLimit(`vaani:${clientIp(req)}`, 300, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  const v = verifyVaani(cfg, raw, req.headers, new URL(req.url));
  if (!v.ok) {
    await recordRejectedEvent(VAANI_PROVIDER_ID, v.reason, { ip: clientIp(req) });
    return NextResponse.json({ error: "unauthorized" }, { status: v.status });
  }

  const p = parseVaani(raw);
  if (p.kind === "invalid") {
    await recordRejectedEvent(VAANI_PROVIDER_ID, p.reason);
    return NextResponse.json({ error: "invalid event", reason: p.reason }, { status: 400 });
  }
  if (p.kind === "ignore") return NextResponse.json({ ok: true, ignored: p.reason });

  try {
    if (p.kind === "timing") {
      const r = await recordVaaniTiming(p);
      return NextResponse.json({ ok: true, recorded: p.eventType, duplicate: !r.stored });
    }
    const received = await receiveEvent(p.event);
    if (received.alreadyProcessed) return NextResponse.json({ ok: true, duplicate: true });
    runAfterResponse(async () => {
      try {
        await processEvent(received.eventId, (e) => enrichVaani(e));
      } catch {
        await markFailed(received.eventId, "post-response processing crashed").catch(() => undefined);
      }
    });
    return NextResponse.json({ ok: true, eventId: received.eventId, duplicate: received.duplicate });
  } catch {
    // Database unavailable → non-2xx so Vaani retries (documented: up to 5 attempts).
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}
