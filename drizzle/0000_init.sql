CREATE TYPE "public"."call_status" AS ENUM('IN_PROGRESS', 'COMPLETED', 'MISSED', 'DISCONNECTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."caller_type" AS ENUM('NEW_PROSPECT', 'EXISTING_CLIENT', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('PHONE');--> statement-breakpoint
CREATE TYPE "public"."consultation_status" AS ENUM('NOT_REQUESTED', 'REQUESTED', 'BOOKED_CONFIRMED', 'HELD');--> statement-breakpoint
CREATE TYPE "public"."conversion_status" AS ENUM('UNKNOWN', 'CONVERTED', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."cost_value_type" AS ENUM('ACTUAL', 'ESTIMATED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."event_processing" AS ENUM('PENDING', 'PROCESSED', 'FAILED', 'IGNORED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."lead_disposition" AS ENUM('PENDING', 'QUALIFIED', 'NOT_QUALIFIED', 'INCOMPLETE', 'HUMAN_REVIEW', 'URGENT_ESCALATION', 'MISSED');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('QUALIFIED_HANDOFF', 'URGENT_ESCALATION', 'MISSED_CALL');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('NOT_REQUIRED', 'PENDING', 'SENT', 'FAILED', 'UNAVAILABLE', 'SIMULATED');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('NORMAL', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('NONE', 'OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'STAFF');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"provider_call_id" text,
	"event_type" text NOT NULL,
	"event_timestamp" timestamp with time zone,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb,
	"processing_status" "event_processing" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"deliveries" integer DEFAULT 1 NOT NULL,
	"last_error" text,
	"enquiry_id" uuid,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"unit" text NOT NULL,
	"rate" numeric(12, 4) NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid,
	"provider_call_id" text,
	"provider" text NOT NULL,
	"category" text NOT NULL,
	"quantity" numeric(12, 4),
	"unit" text NOT NULL,
	"rate_source" text,
	"rate_value" numeric(12, 4),
	"currency" text DEFAULT 'INR' NOT NULL,
	"amount" numeric(14, 4),
	"value_type" "cost_value_type" NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"incurred_at" timestamp with time zone,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"provider" text NOT NULL,
	"provider_call_id" text NOT NULL,
	"channel" "channel" DEFAULT 'PHONE' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"call_status" "call_status" NOT NULL,
	"call_arrived_at" timestamp with time zone,
	"call_started_at" timestamp with time zone,
	"call_ended_at" timestamp with time zone,
	"first_response_at" timestamp with time zone,
	"first_response_method" text,
	"duration_sec" integer,
	"record_completed_at" timestamp with time zone,
	"qualified_at" timestamp with time zone,
	"caller_name" text,
	"caller_phone" text,
	"caller_phone_verified" boolean DEFAULT false NOT NULL,
	"caller_type" "caller_type" DEFAULT 'UNKNOWN' NOT NULL,
	"project_category" text,
	"property_type" text,
	"locality" text,
	"carpet_area_sqft" integer,
	"scope_summary" text,
	"timeline_summary" text,
	"site_readiness" text,
	"decision_maker_status" text,
	"budget_volunteered" text,
	"referral_source" text,
	"preferred_callback_time" text,
	"facts" jsonb,
	"summary" text,
	"transcript" jsonb,
	"provider_summary" text,
	"disposition" "lead_disposition" DEFAULT 'PENDING' NOT NULL,
	"priority" "priority" DEFAULT 'NORMAL' NOT NULL,
	"human_review_status" "review_status" DEFAULT 'NONE' NOT NULL,
	"human_review_reason" text,
	"consultation_status" "consultation_status" DEFAULT 'NOT_REQUESTED' NOT NULL,
	"notification_status" "notification_status" DEFAULT 'NOT_REQUIRED' NOT NULL,
	"conversion_status" "conversion_status" DEFAULT 'UNKNOWN' NOT NULL,
	"project_value_inr" numeric(14, 2),
	"pricing_question_count" integer DEFAULT 0 NOT NULL,
	"pricing_violation" boolean DEFAULT false NOT NULL,
	"escalation_recipient" text,
	"related_enquiry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"destination_type" text DEFAULT 'TELEGRAM' NOT NULL,
	"category" "notification_category" NOT NULL,
	"status" "notification_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"error_category" text,
	"error_detail" text,
	"message_preview" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"rule_version" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"uncertainties" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_codes" text[] NOT NULL,
	"disposition" text NOT NULL,
	"clarification_question" text,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'STAFF' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "call_events" ADD CONSTRAINT "call_events_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_rates" ADD CONSTRAINT "cost_rates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_records" ADD CONSTRAINT "cost_records_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_assessments" ADD CONSTRAINT "qualification_assessments_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_events" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "call_events_dedupe_uq" ON "call_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "call_events_status_idx" ON "call_events" USING btree ("processing_status");--> statement-breakpoint
CREATE INDEX "call_events_call_idx" ON "call_events" USING btree ("provider_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_records_enquiry_cat_uq" ON "cost_records" USING btree ("enquiry_id","provider","category");--> statement-breakpoint
CREATE INDEX "cost_records_incurred_idx" ON "cost_records" USING btree ("incurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_provider_call_uq" ON "enquiries" USING btree ("provider","provider_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_seq_uq" ON "enquiries" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "enquiries_arrived_idx" ON "enquiries" USING btree ("call_arrived_at");--> statement-breakpoint
CREATE INDEX "enquiries_disposition_idx" ON "enquiries" USING btree ("disposition");--> statement-breakpoint
CREATE INDEX "enquiries_phone_idx" ON "enquiries" USING btree ("caller_phone");--> statement-breakpoint
CREATE INDEX "enquiries_demo_idx" ON "enquiries" USING btree ("is_demo");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_enquiry_category_uq" ON "notifications" USING btree ("enquiry_id","category");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");--> statement-breakpoint
CREATE INDEX "qa_enquiry_idx" ON "qualification_assessments" USING btree ("enquiry_id");