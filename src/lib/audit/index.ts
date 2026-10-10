import type { DB } from "@/lib/db/client";
import { auditEvents } from "@/lib/db/schema";

export type AuditAction =
  | "enquiry.created"
  | "enquiry.updated_from_provider"
  | "qualification.completed"
  | "lead.declined"
  | "escalation.triggered"
  | "followup.created"
  | "followup.resolved_by_reconnect"
  | "notification.sent"
  | "notification.failed"
  | "notification.unavailable"
  | "notification.simulated"
  | "notification.retry_requested"
  | "cost.calculated"
  | "disposition.changed"
  | "consultation.changed"
  | "conversion.changed"
  | "review.resolved"
  | "settings.rate_added"
  | "settings.rate_deactivated"
  | "pricing.violation_detected"
  | "webhook.rejected"
  | "auth.login"
  | "auth.login_failed"
  | "data.purged";

export interface Actor {
  type: "system" | "user" | "provider";
  id?: string;
}

export const SYSTEM: Actor = { type: "system" };

/** Writes an audit event. Callers pass already-minimised details: no secrets, no full phone numbers, no transcripts. */
export async function audit(tx: DB | Parameters<Parameters<DB["transaction"]>[0]>[0], actor: Actor, action: AuditAction, entityType: string, entityId: string | null, details?: Record<string, unknown>) {
  await tx.insert(auditEvents).values({ actorType: actor.type, actorId: actor.id ?? null, action, entityType, entityId, details: details ?? null });
}

/** "+919876543210" → "+91•••••3210" for logs and audit details. */
export function maskPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length <= 4 ? "••••" : `${digits.slice(0, 3)}•••••${digits.slice(-4)}`;
}

export function log(level: "info" | "warn" | "error", msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (process.env.APP_ENV !== "test") console.log(line);
}
