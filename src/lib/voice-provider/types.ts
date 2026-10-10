export type InternalCallStatus = "IN_PROGRESS" | "COMPLETED" | "MISSED" | "DISCONNECTED" | "FAILED";

export interface TranscriptTurn {
  role: "AGENT" | "CALLER";
  text: string;
  /** Offset from call start in milliseconds, when the provider supplies it. */
  atMs?: number;
}

/** Provider-agnostic representation of a call event. Everything downstream works on this shape. */
export interface NormalisedCallEvent {
  provider: string;
  kind: "CALL_COMPLETED" | "CALL_FAILED";
  rawEventType: string;
  dedupeKey: string;
  providerCallId: string;
  eventTimestamp?: Date;
  direction: "INBOUND" | "OUTBOUND" | "UNKNOWN";
  providerStatus?: string;
  callStatus: InternalCallStatus;
  fromNumber?: string;
  toNumber?: string;
  durationSec?: number;
  language?: string;
  agentId?: string;
  arrivedAt?: Date;
  startedAt?: Date;
  endedAt?: Date;
  /** Provider's LLM-written summary. Stored for reference only — never used for qualification. */
  summary?: string;
  /** Provider's model-extracted fields. Validated and mapped; never trusted as instructions. */
  collectedData?: Record<string, string | number | boolean | null>;
  recordingUrl?: string;
  transcript?: TranscriptTurn[];
  /** Only set when the provider actually reports a cost for this call. */
  providerCost?: { amount: number; currency: string };
  isDemo: boolean;
  enrichment?: { attempted: boolean; ok: boolean; error?: string };
}

export type VerifyResult = { ok: true } | { ok: false; status: 401 | 400; reason: string };
export type ParseResult = { ok: true; event: NormalisedCallEvent } | { ok: false; reason: string } | { ok: "ignore"; reason: string };

export interface VoiceProviderAdapter {
  id: string;
  /** Authenticate the raw request (signature etc.). Must fail closed. */
  verify(rawBody: string, headers: Headers): VerifyResult;
  parse(rawBody: string, headers: Headers): ParseResult;
  /** Optionally fetch richer call detail (transcript, start time). Failure must not lose the event. */
  enrich?(event: NormalisedCallEvent): Promise<NormalisedCallEvent>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public category: "AUTH" | "RATE_LIMITED" | "TIMEOUT" | "NETWORK" | "NOT_FOUND" | "SERVER" | "BAD_RESPONSE" | "NOT_CONFIGURED",
    public retryable: boolean,
  ) {
    super(message);
  }
}
