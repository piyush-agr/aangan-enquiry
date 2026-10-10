import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { audit, log, maskPhone, SYSTEM } from "@/lib/audit";
import { recordCallCosts } from "@/lib/costs/service";
import { db } from "@/lib/db/client";
import { callEvents, enquiries, qualificationAssessments, type Enquiry } from "@/lib/db/schema";
import { dispatchNotification } from "@/lib/notifications/service";
import { auditTranscript, redactPriceFigures } from "@/lib/pricing-guardrails";
import { assess } from "@/lib/qualification/engine";
import { extractFacts, matchLocation, type Turn } from "@/lib/qualification/extract";
import type { Assessment, ExtractedFacts } from "@/lib/qualification/types";
import type { NormalisedCallEvent, TranscriptTurn } from "@/lib/voice-provider/types";

/** A reconnection from the same verified number within this window is linked to the earlier call. */
export const RECONNECT_WINDOW_MIN = 30;
/** A "completed" call this short, with at most one caller utterance, is recorded as DISCONNECTED. */
export const DISCONNECT_MAX_SEC = 90;

export type ReceiveResult = { eventId: string; duplicate: boolean; alreadyProcessed: boolean };

function serialise(e: NormalisedCallEvent) {
  return JSON.parse(JSON.stringify(e));
}

function revive(p: Record<string, unknown>): NormalisedCallEvent {
  const e = p as unknown as NormalisedCallEvent;
  for (const k of ["eventTimestamp", "arrivedAt", "startedAt", "endedAt"] as const) {
    const v = (p as Record<string, unknown>)[k];
    if (typeof v === "string") (e as unknown as Record<string, unknown>)[k] = new Date(v);
  }
  return e;
}

/**
 * Step 1 — durable, idempotent receipt. A repeated delivery of the same (provider, event, call) hits the
 * unique dedupe key and only increments `deliveries`; it never creates a second enquiry or handoff.
 */
export async function receiveEvent(event: NormalisedCallEvent): Promise<ReceiveResult> {
  const rows = await db()
    .insert(callEvents)
    .values({
      provider: event.provider,
      dedupeKey: event.dedupeKey,
      providerCallId: event.providerCallId,
      eventType: event.rawEventType,
      eventTimestamp: event.eventTimestamp ?? null,
      payload: { normalised: serialise(event) },
      isDemo: event.isDemo,
    })
    .onConflictDoUpdate({ target: callEvents.dedupeKey, set: { deliveries: sql`${callEvents.deliveries} + 1` } })
    .returning({ id: callEvents.id, deliveries: callEvents.deliveries, status: callEvents.processingStatus });
  const r = rows[0]!;
  return { eventId: r.id, duplicate: r.deliveries > 1, alreadyProcessed: r.status === "PROCESSED" || r.status === "IGNORED" };
}

export async function recordRejectedEvent(provider: string, reason: string, meta: Record<string, unknown> = {}) {
  // Rejected webhooks are logged (not stored with payload) so an attacker can't fill the database.
  log("warn", "webhook rejected", { provider, reason, ...meta });
  await audit(db(), { type: "provider", id: provider }, "webhook.rejected", "webhook", null, { reason, ...meta });
}

function summariseTimeline(f: ExtractedFacts): string | null {
  const t = f.timeline?.value;
  if (!t) return null;
  const parts: string[] = [];
  if (t.deadline) parts.push(`complete by ${t.deadline} (~${t.deadlineWeeks} wks from call)`);
  if (t.preferredStart) parts.push(`start ${/^\d{4}/.test(t.preferredStart) ? "from " + t.preferredStart : t.preferredStart}`);
  if (t.flexible) parts.push("flexible");
  if (t.unresolvedEvent) parts.push(`before ${t.unresolvedEvent} (date not given)`);
  return parts.join("; ") || t.raw.join(" ");
}

const SITE_LABEL: Record<string, string> = {
  AVAILABLE: "Available now",
  BARE_SHELL: "Bare shell / empty — available",
  OCCUPIED: "Occupied by caller",
  POSSESSION_PENDING: "Possession pending",
};
const DM_LABEL: Record<string, string> = {
  SELF: "Caller is the decision-maker",
  AUTHORISED_REPRESENTATIVE: "Authorised representative",
  RESEARCH_FOR_OTHERS: "Enquiring for owners (they decide)",
  HOUSEHOLD_UNCONFIRMED: "Household member — authority not confirmed",
};

/** Maps provider-collected fields (model output) into evidence. Unknown keys are kept for display only. */
function collectedDataTurns(cd?: Record<string, unknown>): Turn[] {
  if (!cd) return [];
  const turns: Turn[] = [];
  for (const [k, v] of Object.entries(cd)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    const key = k.toLowerCase().replace(/[^a-z]/g, "");
    const val = String(v).slice(0, 300);
    if (["location", "locality", "area", "city", "propertylocation"].includes(key)) turns.push({ role: "CALLER", text: `The property is in ${val}.` });
    if (["timeline", "deadline", "completionby"].includes(key)) turns.push({ role: "CALLER", text: `We need it done by ${val}.` });
  }
  return turns;
}

function enquiryFields(event: NormalisedCallEvent, f: ExtractedFacts, a: Assessment, transcript: TranscriptTurn[] | undefined, now: Date) {
  const callerTurns = (transcript ?? []).filter((t) => t.role === "CALLER");
  let callStatus = event.callStatus;
  if (callStatus === "COMPLETED" && transcript && (event.durationSec ?? 0) < DISCONNECT_MAX_SEC && callerTurns.length <= 1 && a.disposition === "NEEDS_CLARIFICATION") {
    callStatus = "DISCONNECTED";
  }

  // First voice response: provider start time + offset of the first AGENT utterance. Never the webhook time.
  const firstAgent = (transcript ?? []).find((t) => t.role === "AGENT" && t.atMs !== undefined);
  let firstResponseAt: Date | null = null;
  let firstResponseMethod: string | null = null;
  if (event.startedAt && firstAgent?.atMs !== undefined) {
    firstResponseAt = new Date(event.startedAt.getTime() + firstAgent.atMs);
    firstResponseMethod = event.isDemo ? "simulated" : "provider startedAt + first AGENT transcript offset";
  }

  let disposition: Enquiry["disposition"];
  if (callStatus === "MISSED" || (event.kind === "CALL_FAILED" && !callerTurns.length)) disposition = "MISSED";
  else if (callStatus === "FAILED") disposition = "INCOMPLETE";
  else if (a.disposition === "NEEDS_CLARIFICATION") disposition = "INCOMPLETE"; // call ended with 1–3 still unclear
  else disposition = a.disposition;

  const review =
    disposition === "INCOMPLETE" || disposition === "HUMAN_REVIEW" || disposition === "URGENT_ESCALATION" || disposition === "MISSED" || (disposition === "QUALIFIED" && Boolean(f.humanRequested));
  const reviewReason =
    disposition === "MISSED"
      ? "Missed call — automatic callbacks are out of scope; call back manually."
      : disposition === "URGENT_ESCALATION"
        ? "Existing-client complaint — urgent human response."
        : disposition === "HUMAN_REVIEW"
          ? a.reviewFlags.join(" ")
          : disposition === "INCOMPLETE"
            ? callStatus === "DISCONNECTED"
              ? "Call disconnected before details were captured."
              : callStatus === "FAILED"
                ? "Call failed."
                : `Call ended before criteria were clear: ${a.clarification?.question ?? ""}`
            : f.humanRequested
              ? "Caller asked to speak with a person."
              : null;

  const enrichmentNote = !transcript && event.enrichment && !event.enrichment.ok ? `Provider call detail unavailable (${event.enrichment.error}) — no transcript; check the provider's call history. ` : "";
  return {
    callStatus,
    callArrivedAt: event.arrivedAt ?? event.startedAt ?? null,
    callStartedAt: event.startedAt ?? null,
    callEndedAt: event.endedAt ?? null,
    durationSec: event.durationSec !== undefined ? Math.round(event.durationSec) : null,
    firstResponseAt,
    firstResponseMethod,
    recordCompletedAt: now,
    qualifiedAt: disposition === "QUALIFIED" ? now : null,
    callerName: f.callerName?.value ?? (typeof event.collectedData?.name === "string" ? String(event.collectedData.name).slice(0, 120) : null),
    callerPhone: event.fromNumber ?? null,
    callerPhoneVerified: Boolean(event.fromNumber && !event.isDemo),
    callerType: (f.complaint ? "EXISTING_CLIENT" : f.intent === "NEW_PROJECT" ? "NEW_PROSPECT" : "UNKNOWN") as Enquiry["callerType"],
    projectCategory: f.projectCategory?.value ?? null,
    propertyType: f.propertyType?.value ?? null,
    locality: f.location?.value.locality ?? f.complaint?.value.projectRef ?? null,
    carpetAreaSqFt: f.carpetAreaSqFt?.value ?? null,
    scopeSummary: f.rooms.length ? f.rooms.join(", ") + (f.fullHome?.value ? " (full home)" : "") : f.fullHome?.value ? "Full home" : null,
    timelineSummary: summariseTimeline(f),
    siteReadiness: f.site ? `${SITE_LABEL[f.site.value.status]}${f.site.value.availableInWeeks ? ` (~${f.site.value.availableInWeeks} wks)` : ""}` : null,
    decisionMakerStatus: f.decisionMaker ? DM_LABEL[f.decisionMaker.value] : "Not discussed",
    budgetVolunteered: f.budget?.value.raw ?? null,
    referralSource: f.referralSource?.value ?? null,
    preferredCallbackTime: f.preferredCallbackTime?.value ?? null,
    facts: f as unknown as Record<string, unknown>,
    summary: a.summary,
    transcript: transcript ?? null,
    providerSummary: event.summary ? redactPriceFigures(event.summary).slice(0, 4000) : null,
    disposition,
    priority: (disposition === "MISSED" ? "HIGH" : a.priority) as Enquiry["priority"],
    humanReviewStatus: (review ? "OPEN" : "NONE") as Enquiry["humanReviewStatus"],
    humanReviewReason: reviewReason ? enrichmentNote + reviewReason : enrichmentNote || null,
    consultationStatus: (disposition === "QUALIFIED" && f.consultationRequested?.value ? "REQUESTED" : "NOT_REQUESTED") as Enquiry["consultationStatus"],
    pricingQuestionCount: f.pricingQuestions.length,
    escalationRecipient: f.humanRequested?.value.who ?? (f.complaint ? "a senior person" : null),
  };
}

export interface ProcessOptions {
  fetchImpl?: typeof fetch;
  simulateNotificationFailure?: boolean;
  skipNotification?: boolean;
}

/**
 * Step 2 — turn a received event into an enquiry. Safe to run more than once (manual retry, cron
 * re-processing): the enquiry is upserted on (provider, provider_call_id) and notifications are unique.
 */
export async function processEvent(eventId: string, enrich?: (e: NormalisedCallEvent) => Promise<NormalisedCallEvent>, opts: ProcessOptions = {}): Promise<{ enquiryId: string | null; status: string }> {
  const [existingRow] = await db().select({ status: callEvents.processingStatus, enquiryId: callEvents.enquiryId }).from(callEvents).where(eq(callEvents.id, eventId)).limit(1);
  if (!existingRow) return { enquiryId: null, status: "NOT_FOUND" };
  if (existingRow.status === "PROCESSED" && existingRow.enquiryId) return { enquiryId: existingRow.enquiryId, status: "ALREADY_PROCESSED" };

  // Atomic claim (2-minute lease). A second worker — e.g. the cron job while the webhook's post-response
  // processing is still running — gets nothing back and steps aside.
  const [row] = await db()
    .update(callEvents)
    .set({ attempts: sql`${callEvents.attempts} + 1`, lockedUntil: sql`now() + interval '2 minutes'` })
    .where(and(eq(callEvents.id, eventId), inArray(callEvents.processingStatus, ["PENDING", "FAILED"]), sql`(${callEvents.lockedUntil} is null or ${callEvents.lockedUntil} < now())`))
    .returning();
  if (!row) return { enquiryId: null, status: "IN_PROGRESS_ELSEWHERE" };
  try {
    let event = revive((row.payload as { normalised: Record<string, unknown> }).normalised);
    if (enrich && event.kind === "CALL_COMPLETED" && !event.transcript) event = await enrich(event);

    const transcript = event.transcript;
    const turns: Turn[] = [...(transcript ?? []).map((t) => ({ role: t.role, text: t.text })), ...collectedDataTurns(event.collectedData)];
    const refDate = event.arrivedAt ?? event.startedAt ?? event.eventTimestamp ?? new Date();
    const facts = extractFacts(turns, { referenceDate: refDate });
    if (!facts.location && typeof event.collectedData?.location === "string") {
      const loc = matchLocation(event.collectedData.location);
      if (loc) facts.location = { value: loc, evidence: `collectedData.location=${event.collectedData.location}`, source: "provider-collected-data" };
    }
    const assessment = assess(facts);
    const leaks = auditTranscript(transcript ?? []);
    const now = new Date();
    const fields = enquiryFields(event, facts, assessment, transcript, now);

    const enquiryId = await db().transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: enquiries.id, disposition: enquiries.disposition })
        .from(enquiries)
        .where(and(eq(enquiries.provider, event.provider), eq(enquiries.providerCallId, event.providerCallId)))
        .limit(1);

      let id: string;
      if (existing) {
        // A later event for the same call (e.g. call.completed after call.failed) updates the record.
        await tx.update(enquiries).set({ ...fields, pricingViolation: leaks.length > 0, updatedAt: now }).where(eq(enquiries.id, existing.id));
        id = existing.id;
        await audit(tx, SYSTEM, "enquiry.updated_from_provider", "enquiry", id, { event: event.rawEventType });
      } else {
        const [ins] = await tx
          .insert(enquiries)
          .values({ provider: event.provider, providerCallId: event.providerCallId, isDemo: event.isDemo, ...fields, pricingViolation: leaks.length > 0 })
          .returning({ id: enquiries.id });
        id = ins!.id;
        await audit(tx, event.isDemo ? { type: "user" } : SYSTEM, "enquiry.created", "enquiry", id, { provider: event.provider, demo: event.isDemo, phone: maskPhone(event.fromNumber), status: fields.callStatus });
      }

      if (fields.disposition !== "MISSED") {
        await tx.insert(qualificationAssessments).values({
          enquiryId: id,
          ruleVersion: assessment.ruleVersion,
          criteria: assessment.criteria,
          uncertainties: assessment.uncertainties,
          reviewFlags: assessment.reviewFlags,
          reasonCodes: assessment.reasonCodes,
          disposition: fields.disposition,
          clarificationQuestion: assessment.clarification?.question ?? null,
        });
        await audit(tx, SYSTEM, "qualification.completed", "enquiry", id, { disposition: fields.disposition, ruleVersion: assessment.ruleVersion });
        if (fields.disposition === "NOT_QUALIFIED") await audit(tx, SYSTEM, "lead.declined", "enquiry", id, { failed: assessment.criteria.filter((c) => c.status === "FAIL").map((c) => c.reasonCode) });
        if (fields.disposition === "URGENT_ESCALATION") await audit(tx, SYSTEM, "escalation.triggered", "enquiry", id, { recipient: fields.escalationRecipient });
      }
      if (fields.humanReviewStatus === "OPEN") await audit(tx, SYSTEM, "followup.created", "enquiry", id, { reason: fields.humanReviewReason });
      if (leaks.length) await audit(tx, SYSTEM, "pricing.violation_detected", "enquiry", id, { codes: leaks.map((l) => l.code) });

      await recordCallCosts(tx, {
        enquiryId: id,
        providerCallId: event.providerCallId,
        provider: event.provider,
        durationSec: event.callStatus === "MISSED" ? 0 : event.durationSec,
        providerCost: event.providerCost,
        incurredAt: event.endedAt ?? event.arrivedAt ?? now,
        isDemo: event.isDemo,
      });

      await linkReconnection(tx, id, fields.callerPhone, fields.callArrivedAt, event.isDemo);

      await tx
        .update(callEvents)
        .set({ processingStatus: "PROCESSED", enquiryId: id, lockedUntil: null, lastError: event.enrichment && !event.enrichment.ok ? `enrichment: ${event.enrichment.error}` : null })
        .where(eq(callEvents.id, eventId));
      return id;
    });

    if (!opts.skipNotification) {
      try {
        await dispatchNotification(enquiryId, { fetchImpl: opts.fetchImpl, simulateFailure: opts.simulateNotificationFailure });
      } catch (e) {
        // the enquiry is safe; the failure is visible on the enquiry and retryable
        log("error", "notification dispatch error", { enquiryId, error: (e as Error).message });
        await db().update(enquiries).set({ notificationStatus: "FAILED" }).where(eq(enquiries.id, enquiryId));
      }
    }
    return { enquiryId, status: "PROCESSED" };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    log("error", "event processing failed", { eventId, error: msg });
    await db().update(callEvents).set({ processingStatus: "FAILED", lastError: msg, lockedUntil: null }).where(eq(callEvents.id, eventId));
    return { enquiryId: null, status: "FAILED" };
  }
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** Link (never merge) a call from the same verified number within the reconnect window. */
async function linkReconnection(tx: Tx, id: string, phone: string | null, arrivedAt: Date | null, isDemo: boolean) {
  if (!phone || !arrivedAt) return;
  const since = new Date(arrivedAt.getTime() - RECONNECT_WINDOW_MIN * 60_000);
  const [prev] = await tx
    .select({ id: enquiries.id, disposition: enquiries.disposition, callStatus: enquiries.callStatus, reviewStatus: enquiries.humanReviewStatus })
    .from(enquiries)
    .where(and(eq(enquiries.callerPhone, phone), ne(enquiries.id, id), gte(enquiries.callArrivedAt, since), eq(enquiries.isDemo, isDemo), sql`${enquiries.callArrivedAt} <= ${arrivedAt}`))
    .orderBy(desc(enquiries.callArrivedAt))
    .limit(1);
  if (!prev) return;
  await tx.update(enquiries).set({ relatedEnquiryId: prev.id }).where(eq(enquiries.id, id));
  if (prev.reviewStatus === "OPEN" && (prev.callStatus === "DISCONNECTED" || prev.disposition === "INCOMPLETE" || prev.disposition === "MISSED")) {
    await tx.update(enquiries).set({ humanReviewStatus: "RESOLVED", humanReviewReason: `Caller reconnected — see linked enquiry`, relatedEnquiryId: id }).where(eq(enquiries.id, prev.id));
    await audit(tx, SYSTEM, "followup.resolved_by_reconnect", "enquiry", prev.id, { linkedTo: id });
  }
}

/** Re-process events left PENDING/FAILED (e.g. after an outage). Bounded attempts. */
export async function reprocessPending(enrich?: (e: NormalisedCallEvent) => Promise<NormalisedCallEvent>, maxAttempts = 5, limit = 25) {
  const rows = await db()
    .select({ id: callEvents.id })
    .from(callEvents)
    .where(and(inArray(callEvents.processingStatus, ["PENDING", "FAILED"]), sql`${callEvents.attempts} < ${maxAttempts}`, sql`(${callEvents.lockedUntil} is null or ${callEvents.lockedUntil} < now())`))
    .limit(limit);
  const results = [];
  for (const r of rows) results.push({ id: r.id, ...(await processEvent(r.id, enrich)) });
  return results;
}

export async function markFailed(eventId: string, reason: string) {
  await db().update(callEvents).set({ processingStatus: "FAILED", lastError: reason }).where(eq(callEvents.id, eventId));
}

/** Convenience: receive + process a normalised event (used by the simulator and tests). */
export async function ingest(event: NormalisedCallEvent, enrich?: (e: NormalisedCallEvent) => Promise<NormalisedCallEvent>, opts: ProcessOptions = {}) {
  const r = await receiveEvent(event);
  if (r.alreadyProcessed) {
    const [row] = await db().select({ enquiryId: callEvents.enquiryId }).from(callEvents).where(eq(callEvents.id, r.eventId)).limit(1);
    return { ...r, enquiryId: row?.enquiryId ?? null, status: "DUPLICATE" };
  }
  const p = await processEvent(r.eventId, enrich, opts);
  return { ...r, ...p };
}
