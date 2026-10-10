import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["ADMIN", "STAFF"]);
export const channel = pgEnum("channel", ["PHONE"]); // the only in-scope channel for this build
export const callStatus = pgEnum("call_status", ["IN_PROGRESS", "COMPLETED", "MISSED", "DISCONNECTED", "FAILED"]);
export const leadDisposition = pgEnum("lead_disposition", [
  "PENDING",
  "QUALIFIED",
  "NOT_QUALIFIED",
  "INCOMPLETE",
  "HUMAN_REVIEW",
  "URGENT_ESCALATION",
  "MISSED",
]);
export const priority = pgEnum("priority", ["NORMAL", "HIGH", "URGENT"]);
export const reviewStatus = pgEnum("review_status", ["NONE", "OPEN", "RESOLVED"]);
export const callerType = pgEnum("caller_type", ["NEW_PROSPECT", "EXISTING_CLIENT", "UNKNOWN"]);
export const consultationStatus = pgEnum("consultation_status", ["NOT_REQUESTED", "REQUESTED", "BOOKED_CONFIRMED", "HELD"]);
export const conversionStatus = pgEnum("conversion_status", ["UNKNOWN", "CONVERTED", "LOST"]);
export const notificationStatus = pgEnum("notification_status", ["NOT_REQUIRED", "PENDING", "SENT", "FAILED", "UNAVAILABLE", "SIMULATED"]);
export const notificationCategory = pgEnum("notification_category", ["QUALIFIED_HANDOFF", "URGENT_ESCALATION", "MISSED_CALL"]);
export const eventProcessing = pgEnum("event_processing", ["PENDING", "PROCESSED", "FAILED", "IGNORED", "REJECTED"]);
export const costValueType = pgEnum("cost_value_type", ["ACTUAL", "ESTIMATED", "UNKNOWN"]);

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull().default("STAFF"),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  /** SHA-256 of the session token; the raw token only ever lives in the user's cookie. */
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export const enquiries = pgTable(
  "enquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
    provider: text("provider").notNull(),
    providerCallId: text("provider_call_id").notNull(),
    channel: channel("channel").notNull().default("PHONE"),
    isDemo: boolean("is_demo").notNull().default(false),

    callStatus: callStatus("call_status").notNull(),
    callArrivedAt: ts("call_arrived_at"),
    callStartedAt: ts("call_started_at"),
    callEndedAt: ts("call_ended_at"),
    firstResponseAt: ts("first_response_at"),
    /** How first_response_at was obtained: "provider-transcript-offset", "simulated", or null when unmeasurable. */
    firstResponseMethod: text("first_response_method"),
    durationSec: integer("duration_sec"),
    recordCompletedAt: ts("record_completed_at"),
    qualifiedAt: ts("qualified_at"),

    callerName: text("caller_name"),
    callerPhone: text("caller_phone"),
    callerPhoneVerified: boolean("caller_phone_verified").notNull().default(false),
    callerType: callerType("caller_type").notNull().default("UNKNOWN"),

    projectCategory: text("project_category"),
    propertyType: text("property_type"),
    locality: text("locality"),
    carpetAreaSqFt: integer("carpet_area_sqft"),
    scopeSummary: text("scope_summary"),
    timelineSummary: text("timeline_summary"),
    siteReadiness: text("site_readiness"),
    decisionMakerStatus: text("decision_maker_status"),
    /** Only ever set when the caller volunteered it. Never sent to Telegram. */
    budgetVolunteered: text("budget_volunteered"),
    referralSource: text("referral_source"),
    preferredCallbackTime: text("preferred_callback_time"),
    facts: jsonb("facts"),
    summary: text("summary"),
    /** Restricted: shown only on the authenticated detail page. */
    transcript: jsonb("transcript"),
    providerSummary: text("provider_summary"),

    disposition: leadDisposition("disposition").notNull().default("PENDING"),
    priority: priority("priority").notNull().default("NORMAL"),
    humanReviewStatus: reviewStatus("human_review_status").notNull().default("NONE"),
    humanReviewReason: text("human_review_reason"),
    consultationStatus: consultationStatus("consultation_status").notNull().default("NOT_REQUESTED"),
    notificationStatus: notificationStatus("notification_status").notNull().default("NOT_REQUIRED"),
    conversionStatus: conversionStatus("conversion_status").notNull().default("UNKNOWN"),
    projectValueInr: numeric("project_value_inr", { precision: 14, scale: 2 }),
    pricingQuestionCount: integer("pricing_question_count").notNull().default(0),
    pricingViolation: boolean("pricing_violation").notNull().default(false),
    escalationRecipient: text("escalation_recipient"),
    relatedEnquiryId: uuid("related_enquiry_id"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("enquiries_provider_call_uq").on(t.provider, t.providerCallId),
    uniqueIndex("enquiries_seq_uq").on(t.seq),
    index("enquiries_arrived_idx").on(t.callArrivedAt),
    index("enquiries_disposition_idx").on(t.disposition),
    index("enquiries_phone_idx").on(t.callerPhone),
    index("enquiries_demo_idx").on(t.isDemo),
  ],
);

export const callEvents = pgTable(
  "call_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    /** Deterministic deduplication key (provider + event + call id). Retried webhooks collide here. */
    dedupeKey: text("dedupe_key").notNull(),
    providerCallId: text("provider_call_id"),
    eventType: text("event_type").notNull(),
    eventTimestamp: ts("event_timestamp"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    payload: jsonb("payload"),
    processingStatus: eventProcessing("processing_status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    deliveries: integer("deliveries").notNull().default(1),
    lastError: text("last_error"),
    /** Processing lease: a worker claims the event until this time, so concurrent workers never double-process. */
    lockedUntil: ts("locked_until"),
    enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "set null" }),
    isDemo: boolean("is_demo").notNull().default(false),
  },
  (t) => [uniqueIndex("call_events_dedupe_uq").on(t.dedupeKey), index("call_events_status_idx").on(t.processingStatus), index("call_events_call_idx").on(t.providerCallId)],
);

export const qualificationAssessments = pgTable(
  "qualification_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
    ruleVersion: text("rule_version").notNull(),
    criteria: jsonb("criteria").notNull(),
    uncertainties: jsonb("uncertainties").notNull().default(sql`'[]'::jsonb`),
    reviewFlags: jsonb("review_flags").notNull().default(sql`'[]'::jsonb`),
    reasonCodes: text("reason_codes").array().notNull(),
    disposition: text("disposition").notNull(),
    clarificationQuestion: text("clarification_question"),
    assessedAt: ts("assessed_at").notNull().defaultNow(),
  },
  (t) => [index("qa_enquiry_idx").on(t.enquiryId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
    destinationType: text("destination_type").notNull().default("TELEGRAM"),
    category: notificationCategory("category").notNull(),
    status: notificationStatus("status").notNull().default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    errorCategory: text("error_category"),
    errorDetail: text("error_detail"),
    messagePreview: text("message_preview").notNull(),
    sentAt: ts("sent_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // One notification per enquiry per category — a retried webhook can never produce a second handoff.
  (t) => [uniqueIndex("notifications_enquiry_category_uq").on(t.enquiryId, t.category), index("notifications_status_idx").on(t.status)],
);

export const costRates = pgTable("cost_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  rate: numeric("rate", { precision: 12, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("INR"),
  source: text("source").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const costRecords = pgTable(
  "cost_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    enquiryId: uuid("enquiry_id").references(() => enquiries.id, { onDelete: "cascade" }),
    providerCallId: text("provider_call_id"),
    provider: text("provider").notNull(),
    category: text("category").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 4 }),
    unit: text("unit").notNull(),
    rateSource: text("rate_source"),
    rateValue: numeric("rate_value", { precision: 12, scale: 4 }),
    currency: text("currency").notNull().default("INR"),
    /** NULL when unknown — an unknown cost is never stored as zero. */
    amount: numeric("amount", { precision: 14, scale: 4 }),
    valueType: costValueType("value_type").notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    incurredAt: ts("incurred_at"),
    calculatedAt: ts("calculated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cost_records_enquiry_cat_uq").on(t.enquiryId, t.provider, t.category), index("cost_records_incurred_idx").on(t.incurredAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: ts("at").notNull().defaultNow(),
    actorType: text("actor_type").notNull(), // "system" | "user" | "provider"
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details"),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_at_idx").on(t.at)],
);

export type Enquiry = typeof enquiries.$inferSelect;
export type NewEnquiry = typeof enquiries.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type CostRecord = typeof costRecords.$inferSelect;
export type CostRate = typeof costRates.$inferSelect;
