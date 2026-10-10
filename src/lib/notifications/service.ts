import { and, eq, sql } from "drizzle-orm";
import { audit, log, SYSTEM, type Actor } from "@/lib/audit";
import { config } from "@/lib/config/env";
import { db } from "@/lib/db/client";
import { enquiries, notifications, qualificationAssessments, type Enquiry, type NotificationRow } from "@/lib/db/schema";
import { assertNoPriceLeak, missedCall, qualifiedHandoff, urgentEscalation } from "./format";
import { sendTelegramMessage, type SendResult } from "./telegram";

type Category = NotificationRow["category"];

export function requiredCategory(e: Pick<Enquiry, "disposition">): Category | null {
  switch (e.disposition) {
    case "QUALIFIED":
      return "QUALIFIED_HANDOFF";
    case "URGENT_ESCALATION":
      return "URGENT_ESCALATION";
    case "MISSED":
      return "MISSED_CALL";
    default:
      return null; // declined, incomplete and review cases are never sent to designers automatically
  }
}

async function latestUncertainties(enquiryId: string): Promise<string[]> {
  const rows = await db()
    .select({ u: qualificationAssessments.uncertainties })
    .from(qualificationAssessments)
    .where(eq(qualificationAssessments.enquiryId, enquiryId))
    .orderBy(sql`${qualificationAssessments.assessedAt} desc`)
    .limit(1);
  return (rows[0]?.u as string[] | undefined) ?? [];
}

function render(e: Enquiry, category: Category, uncertainties: string[]): string {
  const o = { baseUrl: config().APP_BASE_URL, uncertainties, demo: e.isDemo };
  if (category === "QUALIFIED_HANDOFF") return qualifiedHandoff(e, o);
  if (category === "URGENT_ESCALATION") return urgentEscalation(e, o);
  return missedCall(e, o);
}

export interface DispatchOptions {
  fetchImpl?: typeof fetch;
  /** Simulator failure injection. */
  simulateFailure?: boolean;
  actor?: Actor;
  /** Manual operator retry of a FAILED/UNAVAILABLE notification. */
  isRetry?: boolean;
}

/**
 * Idempotent: at most one notification row per (enquiry, category), enforced by a unique index; the row
 * is locked FOR UPDATE SKIP LOCKED while sending so concurrent workers can't double-send.
 * Never throws for delivery problems — they are recorded on the row and surfaced in the dashboard.
 */
export async function dispatchNotification(enquiryId: string, opts: DispatchOptions = {}): Promise<NotificationRow | null> {
  const cfg = config();
  const [e] = await db().select().from(enquiries).where(eq(enquiries.id, enquiryId)).limit(1);
  if (!e) return null;
  const category = requiredCategory(e);
  if (!category) {
    await db().update(enquiries).set({ notificationStatus: "NOT_REQUIRED", updatedAt: new Date() }).where(eq(enquiries.id, e.id));
    return null;
  }
  const text = render(e, category, await latestUncertainties(e.id));
  assertNoPriceLeak(text);

  await db().insert(notifications).values({ enquiryId: e.id, category, status: "PENDING", messagePreview: text }).onConflictDoNothing();

  const result = await db().transaction(async (tx) => {
    const locked = await tx.execute(sql`select * from notifications where enquiry_id = ${e.id} and category = ${category} for update skip locked`);
    const row = locked.rows[0] as { id: string; status: NotificationRow["status"]; attempt_count: number } | undefined;
    if (!row) return null; // another worker holds it
    if (row.status === "SENT" || row.status === "SIMULATED") return row.id; // already delivered — idempotent no-op
    if (!opts.isRetry && row.status === "FAILED") return row.id; // failed rows are only resent on explicit retry

    let status: NotificationRow["status"];
    let send: SendResult | null = null;
    const chat = category === "URGENT_ESCALATION" ? cfg.TELEGRAM_URGENT_CHAT_ID ?? cfg.TELEGRAM_DESIGNER_CHAT_ID : cfg.TELEGRAM_DESIGNER_CHAT_ID;
    const telegramReady = Boolean(cfg.TELEGRAM_BOT_TOKEN && chat);

    if (e.isDemo && !(cfg.TELEGRAM_SEND_DEMO && telegramReady)) {
      status = opts.simulateFailure ? "FAILED" : "SIMULATED";
      if (opts.simulateFailure) send = { ok: false, category: "NETWORK", detail: "SIMULATED failure (demo)", retryable: true, attempts: 1 };
    } else if (!telegramReady) {
      status = "UNAVAILABLE";
    } else if (opts.simulateFailure) {
      status = "FAILED";
      send = { ok: false, category: "NETWORK", detail: "SIMULATED failure (demo)", retryable: true, attempts: 1 };
    } else {
      send = await sendTelegramMessage({ token: cfg.TELEGRAM_BOT_TOKEN, apiBase: cfg.TELEGRAM_API_BASE_URL }, chat, text, opts.fetchImpl);
      status = send.ok ? "SENT" : "FAILED";
    }

    await tx
      .update(notifications)
      .set({
        status,
        messagePreview: text,
        attemptCount: sql`${notifications.attemptCount} + ${send?.attempts ?? (status === "SIMULATED" ? 0 : 0)}`,
        providerMessageId: send && send.ok ? send.messageId : null,
        errorCategory: send && !send.ok ? send.category : status === "UNAVAILABLE" ? "NOT_CONFIGURED" : null,
        errorDetail: send && !send.ok ? send.detail : status === "UNAVAILABLE" ? "Telegram bot token / chat id not configured" : null,
        sentAt: status === "SENT" ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(notifications.id, row.id));
    await tx.update(enquiries).set({ notificationStatus: status, updatedAt: new Date() }).where(eq(enquiries.id, e.id));
    const action = status === "SENT" ? "notification.sent" : status === "SIMULATED" ? "notification.simulated" : status === "UNAVAILABLE" ? "notification.unavailable" : "notification.failed";
    await audit(tx, opts.actor ?? SYSTEM, action, "notification", row.id, { category, enquiryId: e.id, error: send && !send.ok ? send.category : undefined, retry: opts.isRetry ?? false });
    if (status === "FAILED") log("warn", "notification failed", { enquiryId: e.id, category, errorCategory: send && !send.ok ? send.category : undefined });
    return row.id;
  });
  if (!result) return null;
  const [row] = await db().select().from(notifications).where(and(eq(notifications.enquiryId, e.id), eq(notifications.category, category))).limit(1);
  return row ?? null;
}

export async function retryNotification(notificationId: string, actor: Actor, opts: DispatchOptions = {}) {
  const [n] = await db().select().from(notifications).where(eq(notifications.id, notificationId)).limit(1);
  if (!n) return { error: "not found" as const };
  if (n.status === "SENT" || n.status === "SIMULATED") return { error: "already delivered" as const };
  await audit(db(), actor, "notification.retry_requested", "notification", n.id, { previousStatus: n.status });
  const row = await dispatchNotification(n.enquiryId, { ...opts, actor, isRetry: true });
  return { row };
}
