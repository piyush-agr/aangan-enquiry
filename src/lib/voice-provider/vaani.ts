import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ProviderError, type NormalisedCallEvent, type TranscriptTurn } from "./types";

/**
 * Vaani AI adapter (app.vaanivoice.ai) — implemented against https://docs.vaanivoice.ai (read 2026-10-10):
 *
 *  - Webhook events (inbound calls): call_started {event, room_name, status, phone_number},
 *    user_picked_up_at {event, room_name, status}, call_ended {event, room_name, call_duration (s), end_reason},
 *    call_postprocessing {event, call_id, timestamp, data:{room_name, call_id, call_duration (ms), end_reason,
 *    summary, entities, dispositions, recording_url, transcript ("[HH:MM:SS] AGENT: …\n\n[HH:MM:SS] USER: …")}}.
 *    Outbound-only events (ringing, rejected, no_answer, failed) are ignored — outbound is out of scope.
 *  - Signing (documented for webhooks): X-Vaani-Signature: sha256=<hex HMAC-SHA256(secret, `${ts}.${rawBody}`)>,
 *    X-Vaani-Timestamp: unix seconds; reject if more than 300 s from now.
 *  - Retries: up to 5 attempts (0, 5, 25, 125, 625 s) on non-2xx → our receipt is idempotent per (event, room).
 *  - REST: base https://api.vaanivoice.ai, header X-API-Key. GET /api/call-history?page&page_size returns
 *    call_id, from_number, to_number, direction, call_status, Start_time, End_time, duration_ms, call_cost (credits).
 *
 * Not documented (so not assumed): whether dashboard "Agent Webhook" deliveries carry the signature headers.
 * We therefore accept EITHER a valid signature OR a `?key=<secret>` query token on the webhook URL — both
 * prove knowledge of the shared secret; anything else is rejected (fail closed).
 */

export const VAANI_PROVIDER_ID = "vaani";
export const VAANI_SIGNATURE_HEADER = "x-vaani-signature";
export const VAANI_TIMESTAMP_HEADER = "x-vaani-timestamp";
export const VAANI_MAX_SKEW_SEC = 300;

export interface VaaniConfig {
  VAANI_API_BASE_URL: string;
  VAANI_API_KEY?: string;
  VAANI_WEBHOOK_SECRET?: string;
}

export function vaaniSignature(secret: string, timestamp: string, rawBody: string) {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest("hex");
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type VaaniVerify = { ok: true; method: "signature" | "url-token" } | { ok: false; status: 401; reason: string };

export function verifyVaani(cfg: VaaniConfig, rawBody: string, headers: Headers, url: URL, now = Date.now()): VaaniVerify {
  const secret = cfg.VAANI_WEBHOOK_SECRET;
  if (!secret) return { ok: false, status: 401, reason: "webhook secret not configured (fail closed)" };
  const sig = headers.get(VAANI_SIGNATURE_HEADER);
  const ts = headers.get(VAANI_TIMESTAMP_HEADER);
  if (sig && ts) {
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum) || Math.abs(now / 1000 - tsNum) > VAANI_MAX_SKEW_SEC) return { ok: false, status: 401, reason: "timestamp outside 300 s window (replay protection)" };
    return safeEqual(sig.trim(), vaaniSignature(secret, ts, rawBody)) ? { ok: true, method: "signature" } : { ok: false, status: 401, reason: "signature mismatch" };
  }
  const key = url.searchParams.get("key");
  if (key && safeEqual(key, secret)) return { ok: true, method: "url-token" };
  return { ok: false, status: 401, reason: "missing signature and URL token" };
}

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const flatRecord = z.record(z.union([primitive, z.array(primitive)])).optional().nullable();

const timingEvent = z.object({
  event: z.enum(["call_started", "user_picked_up_at", "call_ended"]),
  room_name: z.string().min(1).max(200),
  status: z.string().optional().nullable(),
  phone_number: z.string().max(40).optional().nullable(),
  call_duration: z.number().nonnegative().optional().nullable(),
  end_reason: z.string().max(200).optional().nullable(),
});

const postEvent = z.object({
  event: z.literal("call_postprocessing"),
  call_id: z.string().min(1).max(200).optional(),
  timestamp: z.string().optional(),
  campaign_id: z.string().optional().nullable(),
  data: z
    .object({
      room_name: z.string().min(1).max(200),
      call_id: z.string().max(200).optional().nullable(),
      call_duration: z.number().nonnegative().optional().nullable(),
      end_reason: z.string().max(200).optional().nullable(),
      summary: z.string().max(20_000).optional().nullable(),
      entities: flatRecord,
      dispositions: flatRecord,
      recording_url: z.string().optional().nullable(),
      transcript: z.string().max(200_000).optional().nullable(),
    })
    .passthrough(),
});

export type VaaniParse =
  | { kind: "postprocessing"; event: NormalisedCallEvent }
  | { kind: "timing"; eventType: string; roomName: string; dedupeKey: string; phoneNumber?: string; durationSec?: number; endReason?: string }
  | { kind: "ignore"; reason: string }
  | { kind: "invalid"; reason: string };

const OUTBOUND_ONLY = new Set(["call_ringing", "call_rejected", "call_no_answer", "call_failed"]);

/** "[00:00:03] AGENT: Hello…\n\n[00:00:09] USER: Hi" → turns with second offsets. */
export function parseVaaniTranscript(t?: string | null): { turns: TranscriptTurn[]; stamps: number[] } {
  if (!t) return { turns: [], stamps: [] };
  const re = /\[(\d{1,2}):(\d{2}):(\d{2})\]\s*(AGENT|USER|ASSISTANT|CALLER|BOT|HUMAN)\s*:\s*/gi;
  const turns: TranscriptTurn[] = [];
  const stamps: number[] = [];
  const matches = [...t.matchAll(re)];
  matches.forEach((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : t.length;
    const text = t.slice(start, end).trim();
    const secs = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    const role = /AGENT|ASSISTANT|BOT/i.test(m[4]!) ? "AGENT" : "CALLER";
    if (text) {
      turns.push({ role, text, atMs: secs * 1000 });
      stamps.push(secs);
    }
  });
  if (!matches.length && t.trim()) {
    // Unlabelled transcript: keep it as caller text so facts can still be extracted.
    turns.push({ role: "CALLER", text: t.trim() });
  }
  return { turns, stamps };
}

/** Offsets look like "time since call start" when they begin near zero and never go backwards. */
export function stampsAreOffsets(stamps: number[]): boolean {
  if (!stamps.length) return false;
  return stamps[0]! < 600 && stamps.every((s, i) => i === 0 || s >= stamps[i - 1]!);
}

export function parseVaani(rawBody: string): VaaniParse {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { kind: "invalid", reason: "malformed JSON" };
  }
  const ev = (json as { event?: unknown })?.event;
  if (typeof ev !== "string") return { kind: "invalid", reason: "missing event" };
  if (OUTBOUND_ONLY.has(ev) || ev.startsWith("human_transfer") || ev.startsWith("campaign")) return { kind: "ignore", reason: `event ${ev} not used for inbound enquiries` };

  if (ev === "call_postprocessing") {
    const p = postEvent.safeParse(json);
    if (!p.success) return { kind: "invalid", reason: `invalid payload: ${p.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
    const d = p.data.data;
    const room = d.room_name;
    if (/^outbound-/i.test(room) || p.data.campaign_id) return { kind: "ignore", reason: "outbound/campaign call — out of scope" };
    const { turns } = parseVaaniTranscript(d.transcript);
    const collected: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(d.entities ?? {})) collected[k] = Array.isArray(v) ? v.join(", ") : v;
    const ts = p.data.timestamp ? new Date(p.data.timestamp) : undefined;
    return {
      kind: "postprocessing",
      event: {
        provider: VAANI_PROVIDER_ID,
        kind: "CALL_COMPLETED",
        rawEventType: "call_postprocessing",
        dedupeKey: `${VAANI_PROVIDER_ID}:call_postprocessing:${room}`,
        providerCallId: room,
        eventTimestamp: ts && !Number.isNaN(ts.getTime()) ? ts : undefined,
        direction: "INBOUND",
        providerStatus: d.end_reason ?? undefined,
        callStatus: "COMPLETED",
        durationSec: d.call_duration != null ? Math.round(d.call_duration / 1000) : undefined,
        summary: d.summary ?? undefined,
        collectedData: Object.keys(collected).length ? collected : undefined,
        recordingUrl: d.recording_url ?? undefined,
        transcript: turns.length ? turns : undefined,
        isDemo: false,
      },
    };
  }

  const t = timingEvent.safeParse(json);
  if (!t.success) return { kind: "ignore", reason: `unrecognised event ${ev}` };
  if (/^outbound-/i.test(t.data.room_name)) return { kind: "ignore", reason: "outbound call — out of scope" };
  return {
    kind: "timing",
    eventType: t.data.event,
    roomName: t.data.room_name,
    dedupeKey: `${VAANI_PROVIDER_ID}:${t.data.event}:${t.data.room_name}`,
    phoneNumber: t.data.phone_number ?? undefined,
    durationSec: t.data.call_duration ?? undefined,
    endReason: t.data.end_reason ?? undefined,
  };
}

const historySchema = z
  .object({
    calls: z.array(z.record(z.unknown())).optional(),
    data: z.array(z.record(z.unknown())).optional(),
    results: z.array(z.record(z.unknown())).optional(),
    items: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export interface VaaniHistoryRecord {
  fromNumber?: string;
  startTime?: Date;
  endTime?: Date;
  durationMs?: number;
  callCostCredits?: number;
  agentId?: string;
  direction?: string;
}

/** Looks up one call in GET /api/call-history (most recent pages first). Bounded; never throws for "not found". */
export async function fetchVaaniHistory(cfg: VaaniConfig, callId: string, fetchImpl: typeof fetch = fetch, maxPages = 3): Promise<VaaniHistoryRecord | null> {
  if (!cfg.VAANI_API_KEY) throw new ProviderError("API key not configured", "NOT_CONFIGURED", false);
  for (let page = 1; page <= maxPages; page++) {
    const url = `${cfg.VAANI_API_BASE_URL.replace(/\/$/, "")}/api/call-history?page=${page}&page_size=100`;
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { "X-API-Key": cfg.VAANI_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(6_000) });
    } catch (e) {
      const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new ProviderError(timeout ? "timeout" : "network error", timeout ? "TIMEOUT" : "NETWORK", true);
    }
    if (res.status === 401 || res.status === 403) throw new ProviderError(`HTTP ${res.status}`, "AUTH", false);
    if (res.status === 429) throw new ProviderError("rate limited", "RATE_LIMITED", true);
    if (res.status >= 500) throw new ProviderError(`HTTP ${res.status}`, "SERVER", true);
    if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, "BAD_RESPONSE", false);
    const body = await res.json().catch(() => null);
    const list = Array.isArray(body) ? body : (() => {
      const p = historySchema.safeParse(body);
      return p.success ? p.data.calls ?? p.data.data ?? p.data.results ?? p.data.items ?? [] : [];
    })();
    if (!Array.isArray(list)) throw new ProviderError("unexpected call-history shape", "BAD_RESPONSE", false);
    const hit = (list as Record<string, unknown>[]).find((r) => r.call_id === callId || r.room_name === callId);
    if (hit) {
      const d = (k: string) => (typeof hit[k] === "string" ? new Date(hit[k] as string) : undefined);
      const n = (k: string) => (typeof hit[k] === "number" ? (hit[k] as number) : typeof hit[k] === "string" && hit[k] !== "" && !Number.isNaN(Number(hit[k])) ? Number(hit[k]) : undefined);
      return {
        fromNumber: typeof hit.from_number === "string" ? hit.from_number : undefined,
        startTime: d("Start_time") ?? d("start_time"),
        endTime: d("End_time") ?? d("end_time"),
        durationMs: n("duration_ms"),
        callCostCredits: n("call_cost"),
        agentId: typeof hit.agent_id === "string" ? hit.agent_id : undefined,
        direction: typeof hit.direction === "string" ? hit.direction : undefined,
      };
    }
    if (list.length < 100) break;
  }
  return null;
}
