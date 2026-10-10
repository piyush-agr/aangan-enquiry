import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "@/lib/config/env";
import { ProviderError, type InternalCallStatus, type NormalisedCallEvent, type ParseResult, type TranscriptTurn, type VerifyResult, type VoiceProviderAdapter } from "./types";

/**
 * VaaniYantra adapter — implemented ONLY against the contracts in the public Developer Guide
 * (https://vaaniyantra.com/docs/developer-guide, read 2026-10-10):
 *
 *  - Webhooks: POST JSON, events `call.completed` and `call.failed`; headers `X-VaaniYantra-Event`
 *    and `X-VaaniYantra-Signature: sha256=<hex HMAC-SHA256(raw body, whsec_ secret)>`; 6 s timeout;
 *    redirects not followed.
 *  - Payload: { event, timestamp, data: { id, direction, status, fromNumber, toNumber, durationSec,
 *    language, agent{id,name}, summary, sentiment, sentimentScore, topics, collectedData, recordingUrl,
 *    createdAt, endedAt } }. No transcript, no startedAt and no cost field in the webhook.
 *  - REST: base https://vaaniyantra.com/api/v1, `Authorization: Bearer ck_live_…` (scope `calls:read`);
 *    GET /calls/:id returns { call: { …, startedAt, transcript: [{ role: AGENT|CALLER, text, atMs }] } };
 *    120 req/min per key, 429 + Retry-After.
 *  - Status values shown in the guide: COMPLETED, FAILED, NO_ANSWER (list marked non-exhaustive).
 *
 * Not documented (so NOT assumed): a per-event id, retry/redelivery policy, an `answeredAt` field,
 * cost per call, the exact casing of `direction`. Unknown statuses are mapped conservatively.
 */

export const VAANI_PROVIDER_ID = "vaaniyantra";
export const SIGNATURE_HEADER = "x-vaaniyantra-signature";
export const EVENT_HEADER = "x-vaaniyantra-event";

const primitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const webhookSchema = z.object({
  event: z.string().min(1),
  timestamp: z.string().optional(),
  data: z
    .object({
      id: z.string().min(1).max(200),
      direction: z.string().optional().nullable(),
      status: z.string().optional().nullable(),
      fromNumber: z.string().max(40).optional().nullable(),
      toNumber: z.string().max(40).optional().nullable(),
      durationSec: z.number().nonnegative().optional().nullable(),
      language: z.string().optional().nullable(),
      agent: z.object({ id: z.string().optional().nullable(), name: z.string().optional().nullable() }).partial().optional().nullable(),
      summary: z.string().max(20_000).optional().nullable(),
      sentiment: z.string().optional().nullable(),
      sentimentScore: z.number().optional().nullable(),
      topics: z.array(z.string()).optional().nullable(),
      collectedData: z.record(primitive).optional().nullable(),
      recordingUrl: z.string().optional().nullable(),
      createdAt: z.string().optional().nullable(),
      endedAt: z.string().optional().nullable(),
    })
    .passthrough(),
});

const callDetailSchema = z.object({
  call: z
    .object({
      id: z.string(),
      startedAt: z.string().optional().nullable(),
      createdAt: z.string().optional().nullable(),
      endedAt: z.string().optional().nullable(),
      durationSec: z.number().optional().nullable(),
      transcript: z
        .array(z.object({ role: z.string(), text: z.string(), atMs: z.number().optional().nullable() }))
        .optional()
        .nullable(),
      collectedData: z.record(primitive).optional().nullable(),
    })
    .passthrough(),
});

function date(s?: string | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function mapStatus(event: string, status?: string | null): InternalCallStatus {
  const s = (status ?? "").toUpperCase();
  if (s === "NO_ANSWER" || s === "BUSY" || s === "MISSED") return "MISSED";
  if (s === "FAILED" || s === "CANCELED" || s === "CANCELLED") return "FAILED";
  if (s === "COMPLETED") return "COMPLETED";
  if (s === "IN_PROGRESS" || s === "RINGING") return "IN_PROGRESS";
  return event === "call.failed" ? "FAILED" : "COMPLETED";
}

export function computeSignature(rawBody: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export class VaaniYantraAdapter implements VoiceProviderAdapter {
  id = VAANI_PROVIDER_ID;
  constructor(
    private cfg: Pick<AppConfig, "VAANIYANTRA_WEBHOOK_SECRET" | "VAANIYANTRA_API_KEY" | "VAANIYANTRA_API_BASE_URL" | "VAANIYANTRA_AGENT_ID" | "WEBHOOK_MAX_AGE_SECONDS">,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  verify(rawBody: string, headers: Headers): VerifyResult {
    const secret = this.cfg.VAANIYANTRA_WEBHOOK_SECRET;
    if (!secret) return { ok: false, status: 401, reason: "webhook secret not configured (fail closed)" };
    const given = headers.get(SIGNATURE_HEADER);
    if (!given) return { ok: false, status: 401, reason: "missing signature header" };
    const expected = computeSignature(rawBody, secret);
    const a = Buffer.from(given.trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, status: 401, reason: "signature mismatch" };
    return { ok: true };
  }

  parse(rawBody: string, headers: Headers): ParseResult {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return { ok: false, reason: "malformed JSON" };
    }
    const parsed = webhookSchema.safeParse(json);
    if (!parsed.success) return { ok: false, reason: `invalid payload: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
    const p = parsed.data;
    const headerEvent = headers.get(EVENT_HEADER);
    if (headerEvent && headerEvent !== p.event) return { ok: false, reason: "event header does not match body" };
    if (p.event !== "call.completed" && p.event !== "call.failed") return { ok: "ignore", reason: `unsupported event ${p.event}` };

    const ts = date(p.timestamp);
    if (ts && Date.now() - ts.getTime() > this.cfg.WEBHOOK_MAX_AGE_SECONDS * 1000) return { ok: false, reason: "event timestamp too old (replay protection)" };
    if (ts && ts.getTime() - Date.now() > 5 * 60 * 1000) return { ok: false, reason: "event timestamp in the future" };

    const d = p.data;
    const dir = (d.direction ?? "").toUpperCase();
    const direction = dir.startsWith("IN") ? "INBOUND" : dir.startsWith("OUT") ? "OUTBOUND" : "UNKNOWN";
    if (direction === "OUTBOUND") return { ok: "ignore", reason: "outbound call — out of scope for this build" };
    if (this.cfg.VAANIYANTRA_AGENT_ID && d.agent?.id && d.agent.id !== this.cfg.VAANIYANTRA_AGENT_ID) {
      return { ok: "ignore", reason: "event for a different agent" };
    }
    return {
      ok: true,
      event: {
        provider: this.id,
        kind: p.event === "call.completed" ? "CALL_COMPLETED" : "CALL_FAILED",
        rawEventType: p.event,
        // The guide documents no per-event id, so (event, call id) is the idempotency key.
        dedupeKey: `${this.id}:${p.event}:${d.id}`,
        providerCallId: d.id,
        eventTimestamp: ts,
        direction,
        providerStatus: d.status ?? undefined,
        callStatus: mapStatus(p.event, d.status),
        fromNumber: d.fromNumber ?? undefined,
        toNumber: d.toNumber ?? undefined,
        durationSec: d.durationSec ?? undefined,
        language: d.language ?? undefined,
        agentId: d.agent?.id ?? undefined,
        arrivedAt: date(d.createdAt),
        endedAt: date(d.endedAt),
        summary: d.summary ?? undefined,
        collectedData: d.collectedData ?? undefined,
        recordingUrl: d.recordingUrl ?? undefined,
        isDemo: false,
      },
    };
  }

  /** GET /calls/:id for transcript + startedAt. Bounded retries; never throws away the event. */
  async enrich(event: NormalisedCallEvent): Promise<NormalisedCallEvent> {
    if (event.transcript) return event;
    if (!this.cfg.VAANIYANTRA_API_KEY) {
      return { ...event, enrichment: { attempted: false, ok: false, error: "API key not configured" } };
    }
    try {
      const detail = await this.getCall(event.providerCallId);
      const c = detail.call;
      const transcript: TranscriptTurn[] | undefined = c.transcript?.map((t) => ({
        role: t.role.toUpperCase() === "AGENT" ? "AGENT" : "CALLER",
        text: t.text,
        atMs: t.atMs ?? undefined,
      }));
      return {
        ...event,
        startedAt: date(c.startedAt) ?? event.startedAt,
        arrivedAt: event.arrivedAt ?? date(c.createdAt),
        endedAt: event.endedAt ?? date(c.endedAt),
        durationSec: event.durationSec ?? c.durationSec ?? undefined,
        collectedData: event.collectedData ?? c.collectedData ?? undefined,
        transcript,
        enrichment: { attempted: true, ok: true },
      };
    } catch (e) {
      const msg = e instanceof ProviderError ? `${e.category}: ${e.message}` : "unexpected error";
      return { ...event, enrichment: { attempted: true, ok: false, error: msg } };
    }
  }

  async getCall(id: string, attempts = 3) {
    const url = `${this.cfg.VAANIYANTRA_API_BASE_URL.replace(/\/$/, "")}/calls/${encodeURIComponent(id)}`;
    let last: ProviderError | undefined;
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.cfg.VAANIYANTRA_API_KEY}`, Accept: "application/json" },
          signal: AbortSignal.timeout(5_000),
          redirect: "error",
        });
        if (res.status === 401 || res.status === 403) throw new ProviderError(`HTTP ${res.status}`, "AUTH", false);
        if (res.status === 404) throw new ProviderError("call not found", "NOT_FOUND", false);
        if (res.status === 429) {
          const ra = Math.min(Number(res.headers.get("retry-after") ?? "1") || 1, 5);
          last = new ProviderError("rate limited", "RATE_LIMITED", true);
          await sleep(ra * 1000);
          continue;
        }
        if (res.status >= 500) throw new ProviderError(`HTTP ${res.status}`, "SERVER", true);
        if (!res.ok) throw new ProviderError(`HTTP ${res.status}`, "BAD_RESPONSE", false);
        const parsed = callDetailSchema.safeParse(await res.json());
        if (!parsed.success) throw new ProviderError("unexpected call-detail shape", "BAD_RESPONSE", false);
        return parsed.data;
      } catch (e) {
        if (e instanceof ProviderError) {
          if (!e.retryable) throw e;
          last = e;
        } else if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
          last = new ProviderError("timeout", "TIMEOUT", true);
        } else {
          last = new ProviderError("network error", "NETWORK", true);
        }
        await sleep(300 * 2 ** i);
      }
    }
    throw last ?? new ProviderError("failed", "NETWORK", true);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, process.env.APP_ENV === "test" ? Math.min(ms, 5) : ms));
}
