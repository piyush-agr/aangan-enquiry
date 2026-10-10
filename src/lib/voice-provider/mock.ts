import { randomUUID } from "node:crypto";
import type { ConversationState } from "@/lib/conversation/agent";
import type { NormalisedCallEvent, ParseResult, VerifyResult, VoiceProviderAdapter } from "./types";

/**
 * Mock voice provider. Produces NormalisedCallEvents from the in-app simulator so that demo calls go
 * through exactly the same ingestion, qualification, notification and cost pipeline as real calls.
 * Everything it produces is flagged isDemo=true and excluded from production reporting.
 */
export const MOCK_PROVIDER_ID = "mock";

export class MockVoiceAdapter implements VoiceProviderAdapter {
  id = MOCK_PROVIDER_ID;
  verify(): VerifyResult {
    // Mock events never arrive over the public webhook; they are created server-side by authenticated users.
    return { ok: false, status: 401, reason: "mock provider does not accept webhooks" };
  }
  parse(): ParseResult {
    return { ok: false, reason: "mock provider does not accept webhooks" };
  }
}

export interface SimulatedCallInput {
  state?: ConversationState;
  callerPhone?: string;
  outcome?: "COMPLETED" | "MISSED" | "DISCONNECTED";
  /** Failure injection for demos/tests. */
  simulateProviderFailure?: boolean;
  callId?: string;
  startedAt?: Date;
  scenarioId?: string;
}

/**
 * Builds a call event from a finished simulator conversation. Turn offsets are simulated at a fixed
 * speaking pace and labelled "simulated" so they can never be confused with measured latency.
 */
export function simulatedCallEvent(input: SimulatedCallInput): NormalisedCallEvent {
  const id = input.callId ?? `mock_${randomUUID()}`;
  const started = input.startedAt ?? new Date();
  const outcome = input.outcome ?? "COMPLETED";
  const turns = input.state?.turns ?? [];
  let t = 1500; // simulated pick-up + greeting latency
  const transcript = turns.map((turn) => {
    const at = t;
    t += 2500 + turn.text.length * 55;
    return { role: turn.role, text: turn.text, atMs: at };
  });
  const durationSec = outcome === "MISSED" ? 0 : Math.max(5, Math.round(t / 1000));
  return {
    provider: MOCK_PROVIDER_ID,
    kind: outcome === "MISSED" ? "CALL_FAILED" : "CALL_COMPLETED",
    rawEventType: outcome === "MISSED" ? "mock.call.failed" : "mock.call.completed",
    dedupeKey: `${MOCK_PROVIDER_ID}:${outcome}:${id}`,
    providerCallId: id,
    eventTimestamp: new Date(started.getTime() + durationSec * 1000),
    direction: "INBOUND",
    providerStatus: outcome === "MISSED" ? "NO_ANSWER" : "COMPLETED",
    callStatus: outcome,
    fromNumber: input.callerPhone,
    toNumber: "+91-STUDIO-DEMO",
    durationSec,
    language: "en-IN",
    arrivedAt: started,
    startedAt: outcome === "MISSED" ? undefined : started,
    endedAt: new Date(started.getTime() + durationSec * 1000),
    // Simulated provider failure: the call happened but its detail could not be retrieved.
    transcript: outcome === "MISSED" || input.simulateProviderFailure ? undefined : transcript,
    isDemo: true,
    enrichment: input.simulateProviderFailure
      ? { attempted: true, ok: false, error: "SIMULATED: provider call-detail API unavailable" }
      : { attempted: false, ok: true },
  };
}
