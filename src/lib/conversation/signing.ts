import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config/env";
import type { ConversationState } from "./agent";

/** Simulator state round-trips through the browser; an HMAC stops it being edited client-side. */
export function signState(state: ConversationState): string {
  return createHmac("sha256", config().SESSION_SECRET).update("sim:" + JSON.stringify(state)).digest("base64url");
}

export function verifyState(state: unknown, sig: unknown): state is ConversationState {
  if (typeof sig !== "string" || !state || typeof state !== "object") return false;
  const expected = Buffer.from(signState(state as ConversationState));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
