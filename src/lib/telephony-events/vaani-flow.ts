import { and, eq, inArray } from "drizzle-orm";
import { log } from "@/lib/audit";
import { config } from "@/lib/config/env";
import { db } from "@/lib/db/client";
import { callEvents } from "@/lib/db/schema";
import { fetchVaaniHistory, parseVaaniTranscript, stampsAreOffsets, VAANI_PROVIDER_ID } from "@/lib/voice-provider/vaani";
import { ProviderError, type NormalisedCallEvent } from "@/lib/voice-provider/types";

/**
 * Vaani AI sends call lifecycle events (call_started, user_picked_up_at, call_ended) in real time and the
 * transcript later in call_postprocessing. We store the lifecycle events (idempotently) and join them to the
 * postprocessing event by room_name, which gives us:
 *   - arrival time   = when call_started reached us (it is pushed live; no timestamp is in its payload)
 *   - caller number  = call_started.phone_number (inbound: the participant who connected)
 *   - first response = arrival + offset of the first AGENT line, when the transcript's [HH:MM:SS] stamps are
 *                      offsets from call start; otherwise not measurable (never guessed)
 */
export async function recordVaaniTiming(t: { eventType: string; roomName: string; dedupeKey: string; phoneNumber?: string; durationSec?: number; endReason?: string }) {
  const rows = await db()
    .insert(callEvents)
    .values({
      provider: VAANI_PROVIDER_ID,
      dedupeKey: t.dedupeKey,
      providerCallId: t.roomName,
      eventType: t.eventType,
      payload: { timing: { phoneNumber: t.phoneNumber ?? null, durationSec: t.durationSec ?? null, endReason: t.endReason ?? null } },
      processingStatus: "IGNORED",
      lastError: null,
    })
    .onConflictDoNothing()
    .returning({ id: callEvents.id });
  return { stored: rows.length > 0 };
}

export async function enrichVaani(event: NormalisedCallEvent, fetchImpl: typeof fetch = fetch): Promise<NormalisedCallEvent> {
  const cfg = config();
  const out: NormalisedCallEvent = { ...event };
  const timings = await db()
    .select({ eventType: callEvents.eventType, receivedAt: callEvents.receivedAt, payload: callEvents.payload })
    .from(callEvents)
    .where(and(eq(callEvents.provider, VAANI_PROVIDER_ID), eq(callEvents.providerCallId, event.providerCallId), inArray(callEvents.eventType, ["call_started", "user_picked_up_at", "call_ended"])));
  const started = timings.find((t) => t.eventType === "call_started");
  const ended = timings.find((t) => t.eventType === "call_ended");
  const startedPhone = (started?.payload as { timing?: { phoneNumber?: string | null } } | null)?.timing?.phoneNumber ?? undefined;
  if (started) {
    out.arrivedAt = started.receivedAt;
    out.startedAt = started.receivedAt;
  }
  if (ended) out.endedAt = ended.receivedAt;
  if (startedPhone) out.fromNumber = startedPhone;

  // First voice response from transcript offsets, only when the stamps really are offsets.
  const firstAgent = out.transcript?.find((t) => t.role === "AGENT" && t.atMs !== undefined);
  const stamps = (out.transcript ?? []).filter((t) => t.atMs !== undefined).map((t) => t.atMs! / 1000);
  if (out.startedAt && firstAgent && stampsAreOffsets(stamps)) {
    out.firstResponse = { at: new Date(out.startedAt.getTime() + firstAgent.atMs!), method: "Vaani call_started receipt + first AGENT transcript offset" };
  } else if (out.transcript) {
    // Stamps are wall-clock (or absent): drop them so no latency is derived from them.
    out.transcript = out.transcript.map((t) => ({ role: t.role, text: t.text }));
  }

  if (!cfg.VAANI_API_KEY) {
    return { ...out, enrichment: { attempted: false, ok: false, error: "VAANI_API_KEY not configured — call history (cost, number) not fetched" } };
  }
  try {
    const h = await fetchVaaniHistory(cfg, event.providerCallId, fetchImpl);
    if (!h) return { ...out, enrichment: { attempted: true, ok: false, error: "call not found in call history yet" } };
    if (h.direction && /^out/i.test(h.direction)) log("warn", "vaani call-history says outbound", { call: event.providerCallId });
    return {
      ...out,
      fromNumber: out.fromNumber ?? h.fromNumber,
      providerUsage: h.callCostCredits !== undefined ? { credits: h.callCostCredits } : undefined,
      agentId: h.agentId,
      enrichment: { attempted: true, ok: true },
    };
  } catch (e) {
    const msg = e instanceof ProviderError ? `${e.category}: ${e.message}` : "unexpected error";
    return { ...out, enrichment: { attempted: true, ok: false, error: msg } };
  }
}

export { parseVaaniTranscript };
