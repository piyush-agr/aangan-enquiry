import { and, asc, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { audit, type Actor } from "@/lib/audit";
import { db } from "@/lib/db/client";
import { auditEvents, callEvents, costRecords, enquiries, notifications, qualificationAssessments } from "@/lib/db/schema";

export const listQuerySchema = z.object({
  q: z.string().max(100).optional(),
  disposition: z.enum(["PENDING", "QUALIFIED", "NOT_QUALIFIED", "INCOMPLETE", "HUMAN_REVIEW", "URGENT_ESCALATION", "MISSED"]).optional(),
  callStatus: z.enum(["IN_PROGRESS", "COMPLETED", "MISSED", "DISCONNECTED", "FAILED"]).optional(),
  notification: z.enum(["NOT_REQUIRED", "PENDING", "SENT", "FAILED", "UNAVAILABLE", "SIMULATED"]).optional(),
  review: z.enum(["OPEN", "RESOLVED", "NONE"]).optional(),
  category: z.enum(["RESIDENTIAL", "COMMERCIAL"]).optional(),
  locality: z.string().max(60).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  demo: z.enum(["0", "1", "only"]).optional(),
  sort: z.enum(["newest", "oldest", "priority"]).default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export function parseListQuery(sp: Record<string, string | string[] | undefined>): ListQuery {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val !== undefined && val !== "") flat[k] = val;
  }
  const r = listQuerySchema.safeParse(flat);
  return r.success ? r.data : listQuerySchema.parse({});
}

export async function listEnquiries(q: ListQuery) {
  const where: (SQL | undefined)[] = [];
  if (q.q) {
    const term = `%${q.q.replace(/[%_]/g, "")}%`;
    where.push(or(ilike(enquiries.callerName, term), ilike(enquiries.locality, term), ilike(enquiries.summary, term), ilike(enquiries.callerPhone, term)));
  }
  if (q.disposition) where.push(eq(enquiries.disposition, q.disposition));
  if (q.callStatus) where.push(eq(enquiries.callStatus, q.callStatus));
  if (q.notification) where.push(eq(enquiries.notificationStatus, q.notification));
  if (q.review) where.push(eq(enquiries.humanReviewStatus, q.review));
  if (q.category) where.push(eq(enquiries.projectCategory, q.category));
  if (q.locality) where.push(ilike(enquiries.locality, `%${q.locality.replace(/[%_]/g, "")}%`));
  if (q.from) where.push(gte(enquiries.callArrivedAt, new Date(`${q.from}T00:00:00+05:30`)));
  if (q.to) where.push(lt(enquiries.callArrivedAt, new Date(`${q.to}T23:59:59.999+05:30`)));
  if (q.demo === "only") where.push(eq(enquiries.isDemo, true));
  else if (q.demo !== "1") where.push(eq(enquiries.isDemo, false));
  const cond = and(...where);
  const order =
    q.sort === "oldest"
      ? [asc(enquiries.callArrivedAt)]
      : q.sort === "priority"
        ? [sql`case ${enquiries.priority} when 'URGENT' then 0 when 'HIGH' then 1 else 2 end`, desc(enquiries.callArrivedAt)]
        : [desc(enquiries.callArrivedAt)];
  const [rows, [count]] = await Promise.all([
    db()
      .select({
        id: enquiries.id,
        seq: enquiries.seq,
        isDemo: enquiries.isDemo,
        callArrivedAt: enquiries.callArrivedAt,
        callStatus: enquiries.callStatus,
        callerName: enquiries.callerName,
        projectCategory: enquiries.projectCategory,
        propertyType: enquiries.propertyType,
        locality: enquiries.locality,
        disposition: enquiries.disposition,
        priority: enquiries.priority,
        humanReviewStatus: enquiries.humanReviewStatus,
        notificationStatus: enquiries.notificationStatus,
        consultationStatus: enquiries.consultationStatus,
        summary: enquiries.summary,
      })
      .from(enquiries)
      .where(cond)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db().select({ n: sql<number>`count(*)::int` }).from(enquiries).where(cond),
  ]);
  return { rows, total: count?.n ?? 0, page: q.page, pageSize: q.pageSize };
}

export async function getEnquiryDetail(id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [e] = await db().select().from(enquiries).where(eq(enquiries.id, id)).limit(1);
  if (!e) return null;
  const [assessments, notes, costs, events, auditRows, related] = await Promise.all([
    db().select().from(qualificationAssessments).where(eq(qualificationAssessments.enquiryId, id)).orderBy(desc(qualificationAssessments.assessedAt)),
    db().select().from(notifications).where(eq(notifications.enquiryId, id)),
    db().select().from(costRecords).where(eq(costRecords.enquiryId, id)),
    db()
      .select({ id: callEvents.id, eventType: callEvents.eventType, receivedAt: callEvents.receivedAt, processingStatus: callEvents.processingStatus, attempts: callEvents.attempts, deliveries: callEvents.deliveries, lastError: callEvents.lastError })
      .from(callEvents)
      .where(eq(callEvents.enquiryId, id)),
    db().select().from(auditEvents).where(or(eq(auditEvents.entityId, id), sql`${auditEvents.details}->>'enquiryId' = ${id}`)).orderBy(desc(auditEvents.at)).limit(50),
    e.relatedEnquiryId ? db().select({ id: enquiries.id, seq: enquiries.seq, disposition: enquiries.disposition, callStatus: enquiries.callStatus }).from(enquiries).where(eq(enquiries.id, e.relatedEnquiryId)) : Promise.resolve([]),
  ]);
  return { enquiry: e, assessments, notifications: notes, costs, events, audit: auditRows, related: related[0] ?? null };
}

export const updateSchema = z
  .object({
    disposition: z.enum(["QUALIFIED", "NOT_QUALIFIED", "INCOMPLETE", "HUMAN_REVIEW", "URGENT_ESCALATION", "MISSED"]).optional(),
    consultationStatus: z.enum(["NOT_REQUESTED", "REQUESTED", "BOOKED_CONFIRMED", "HELD"]).optional(),
    conversionStatus: z.enum(["UNKNOWN", "CONVERTED", "LOST"]).optional(),
    projectValueInr: z.number().positive().max(100_000_000).nullable().optional(),
    humanReviewStatus: z.enum(["OPEN", "RESOLVED"]).optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== "note"), "nothing to update");

/** Manual operator changes — every change is audited with who and when. */
export async function updateEnquiry(id: string, input: z.infer<typeof updateSchema>, actor: Actor) {
  const [before] = await db().select().from(enquiries).where(eq(enquiries.id, id)).limit(1);
  if (!before) return null;
  return db().transaction(async (tx) => {
    const set: Partial<typeof enquiries.$inferInsert> = { updatedAt: new Date() };
    if (input.disposition && input.disposition !== before.disposition) {
      set.disposition = input.disposition;
      await audit(tx, actor, "disposition.changed", "enquiry", id, { from: before.disposition, to: input.disposition, note: input.note });
    }
    if (input.consultationStatus && input.consultationStatus !== before.consultationStatus) {
      set.consultationStatus = input.consultationStatus;
      await audit(tx, actor, "consultation.changed", "enquiry", id, { from: before.consultationStatus, to: input.consultationStatus, note: input.note });
    }
    if (input.conversionStatus || input.projectValueInr !== undefined) {
      if (input.conversionStatus) set.conversionStatus = input.conversionStatus;
      if (input.projectValueInr !== undefined) set.projectValueInr = input.projectValueInr === null ? null : String(input.projectValueInr);
      await audit(tx, actor, "conversion.changed", "enquiry", id, { from: before.conversionStatus, to: input.conversionStatus ?? before.conversionStatus, valueRecorded: input.projectValueInr !== undefined && input.projectValueInr !== null });
    }
    if (input.humanReviewStatus && input.humanReviewStatus !== before.humanReviewStatus) {
      set.humanReviewStatus = input.humanReviewStatus;
      await audit(tx, actor, "review.resolved", "enquiry", id, { to: input.humanReviewStatus, note: input.note });
    }
    const [after] = await tx.update(enquiries).set(set).where(eq(enquiries.id, id)).returning();
    return after!;
  });
}
