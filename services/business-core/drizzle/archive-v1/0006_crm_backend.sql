CREATE TYPE "public"."automation_definition_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."automation_run_status" AS ENUM('queued', 'running', 'waiting', 'approval_required', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."crm_activity_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."crm_activity_type" AS ENUM('task', 'note', 'call', 'meeting', 'email', 'whatsapp', 'sms', 'portal', 'other');--> statement-breakpoint
CREATE TYPE "public"."crm_consent_status" AS ENUM('unknown', 'granted', 'denied', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."crm_contact_point_type" AS ENUM('email', 'phone', 'social', 'other');--> statement-breakpoint
CREATE TYPE "public"."crm_intake_status" AS ENUM('received', 'processing', 'ready', 'needs_review', 'failed', 'duplicate_candidate', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."crm_lead_status" AS ENUM('new', 'attempting_contact', 'connected', 'nurturing', 'qualified', 'disqualified', 'paused');--> statement-breakpoint
CREATE TYPE "public"."crm_message_direction" AS ENUM('inbound', 'outbound', 'internal');--> statement-breakpoint
CREATE TYPE "public"."crm_message_status" AS ENUM('draft', 'queued', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."crm_opportunity_status" AS ENUM('open', 'won', 'lost', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."crm_party_type" AS ENUM('person', 'organization', 'household');--> statement-breakpoint
CREATE TYPE "public"."crm_record_status" AS ENUM('active', 'merged', 'archived');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'scheduled', 'processing', 'delivered', 'failed', 'cancelled', 'suppressed');--> statement-breakpoint
CREATE TABLE "automation_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" varchar(100) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"proposed_action" jsonb NOT NULL,
	"requested_from_membership_id" uuid,
	"decided_by" uuid,
	"decision_reason" text,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" varchar(100) NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text,
	"status" "automation_definition_status" DEFAULT 'draft' NOT NULL,
	"active_version_id" uuid,
	"run_once_per_aggregate" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"trigger_event_id" uuid NOT NULL,
	"aggregate_type" varchar(80) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"status" "automation_run_status" DEFAULT 'queued' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"current_step_key" varchar(100),
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" varchar(120),
	"failure_message" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_step_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" varchar(100) NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" varchar(30) NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"error" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_waits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_key" varchar(100) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(30) DEFAULT 'waiting' NOT NULL,
	"claimed_at" timestamp with time zone,
	"claim_token" uuid,
	"completed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"party_id" uuid,
	"lead_id" uuid,
	"opportunity_id" uuid,
	"type" "crm_activity_type" NOT NULL,
	"status" "crm_activity_status" DEFAULT 'pending' NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text,
	"owner_membership_id" uuid,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"due_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completion_outcome" varchar(120),
	"is_next_action" boolean DEFAULT false NOT NULL,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"label" varchar(80),
	"line1" varchar(240),
	"line2" varchar(240),
	"locality" varchar(160),
	"region" varchar(160),
	"postal_code" varchar(40),
	"country_code" varchar(2) NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"is_primary" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"activity_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"location" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attendee_party_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attendee_membership_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_calendar_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attendance_status" varchar(30) DEFAULT 'scheduled' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_appointments_time_check" CHECK ("crm_appointments"."ends_at" > "crm_appointments"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "crm_assignment_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"previous_owner_membership_id" uuid,
	"owner_membership_id" uuid,
	"queue_id" uuid,
	"assignment_method" varchar(40) NOT NULL,
	"rule_id" uuid,
	"explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_assignment_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"fallback_queue_id" uuid,
	"preserve_relationship_owner" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_assignment_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_attribution_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"source" varchar(100) NOT NULL,
	"medium" varchar(100),
	"campaign" varchar(160),
	"content" varchar(160),
	"term" varchar(160),
	"referrer" text,
	"external_click_id" varchar(255),
	"touched_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"legal_entity_id" uuid,
	"purpose" varchar(80) NOT NULL,
	"channel" varchar(40) NOT NULL,
	"status" "crm_consent_status" DEFAULT 'unknown' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"jurisdiction" varchar(20),
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_contact_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"type" "crm_contact_point_type" NOT NULL,
	"label" varchar(80),
	"raw_value" varchar(500) NOT NULL,
	"normalized_value" "citext",
	"country_code" varchar(2),
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"invalid_reason" varchar(120),
	"status" "crm_record_status" DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_conversation_participants" (
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"participant_type" varchar(30) NOT NULL,
	"participant_id" uuid NOT NULL,
	"role" varchar(30) DEFAULT 'participant' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_conversation_participants_conversation_id_participant_type_participant_id_pk" PRIMARY KEY("conversation_id","participant_type","participant_id")
);
--> statement-breakpoint
CREATE TABLE "crm_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"party_id" uuid,
	"lead_id" uuid,
	"channel" varchar(40) NOT NULL,
	"provider_thread_id" varchar(500),
	"subject" varchar(500),
	"status" varchar(30) DEFAULT 'open' NOT NULL,
	"owner_membership_id" uuid,
	"last_message_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(160) NOT NULL,
	"data_type" varchar(30) NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"searchable" boolean DEFAULT false NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" uuid NOT NULL,
	"value_text" text,
	"value_number" numeric(30, 10),
	"value_boolean" boolean,
	"value_timestamp" timestamp with time zone,
	"value_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_custom_field_values_one_value_check" CHECK (num_nonnulls("crm_custom_field_values"."value_text", "crm_custom_field_values"."value_number", "crm_custom_field_values"."value_boolean", "crm_custom_field_values"."value_timestamp", "crm_custom_field_values"."value_json") = 1)
);
--> statement-breakpoint
CREATE TABLE "crm_enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"intake_event_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"summary" text,
	"service_type" varchar(100),
	"source" varchar(100) NOT NULL,
	"channel" varchar(60) NOT NULL,
	"status" varchar(40) DEFAULT 'open' NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_forecast_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"owner_membership_id" uuid,
	"stage_id" uuid,
	"status" "crm_opportunity_status" NOT NULL,
	"amount" numeric(20, 4),
	"currency_code" varchar(3),
	"reporting_amount" numeric(20, 4),
	"reporting_currency_code" varchar(3),
	"probability" numeric(5, 2),
	"snapshot_reason" varchar(80) NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_identity_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"intake_event_id" uuid NOT NULL,
	"candidate_party_id" uuid NOT NULL,
	"strength" varchar(20) NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"decision_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_identity_candidate_score_check" CHECK ("crm_identity_candidates"."score" >= 0 AND "crm_identity_candidates"."score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "crm_intake_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"legal_entity_id" uuid,
	"business_unit_id" uuid,
	"source" varchar(100) NOT NULL,
	"channel" varchar(60) NOT NULL,
	"intake_method" varchar(40) NOT NULL,
	"external_event_id" varchar(255),
	"idempotency_key" varchar(160) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"original_payload" jsonb NOT NULL,
	"payload_reference" varchar(500),
	"status" "crm_intake_status" DEFAULT 'received' NOT NULL,
	"failure_code" varchar(120),
	"failure_message" text,
	"correlation_id" uuid NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_lead_qualification_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"question_key" varchar(100) NOT NULL,
	"value" jsonb NOT NULL,
	"captured_by" uuid,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"owner_membership_id" uuid,
	"queue_id" uuid,
	"status" "crm_lead_status" DEFAULT 'new' NOT NULL,
	"priority" varchar(20) DEFAULT 'normal' NOT NULL,
	"fit_score" numeric(5, 2),
	"engagement_score" numeric(5, 2),
	"disqualification_reason" varchar(160),
	"paused_reason" varchar(160),
	"next_action_at" timestamp with time zone,
	"qualified_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_merge_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"survivor_party_id" uuid NOT NULL,
	"merged_party_id" uuid NOT NULL,
	"field_decisions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"performed_by" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_merge_operations_distinct_check" CHECK ("crm_merge_operations"."survivor_party_id" <> "crm_merge_operations"."merged_party_id")
);
--> statement-breakpoint
CREATE TABLE "crm_message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"object_key" varchar(500) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"byte_size" integer NOT NULL,
	"checksum" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "crm_message_direction" NOT NULL,
	"status" "crm_message_status" DEFAULT 'draft' NOT NULL,
	"sender_type" varchar(30) NOT NULL,
	"sender_id" uuid,
	"provider_message_id" varchar(500),
	"body_text" text,
	"body_html" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failure_code" varchar(120),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"legal_entity_id" uuid,
	"business_unit_id" uuid,
	"party_id" uuid NOT NULL,
	"lead_id" uuid,
	"pipeline_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"owner_membership_id" uuid,
	"title" varchar(240) NOT NULL,
	"description" text,
	"status" "crm_opportunity_status" DEFAULT 'open' NOT NULL,
	"amount" numeric(20, 4),
	"currency_code" varchar(3),
	"probability" numeric(5, 2),
	"forecast_category" varchar(40) DEFAULT 'pipeline' NOT NULL,
	"expected_close_at" timestamp with time zone,
	"next_action_at" timestamp with time zone,
	"paused_reason" varchar(160),
	"outcome_reason" varchar(160),
	"competitor" varchar(160),
	"closed_at" timestamp with time zone,
	"reporting_currency_code" varchar(3),
	"reporting_amount" numeric(20, 4),
	"exchange_rate" numeric(24, 12),
	"exchange_rate_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_opportunities_amount_currency_check" CHECK (("crm_opportunities"."amount" IS NULL AND "crm_opportunities"."currency_code" IS NULL) OR ("crm_opportunities"."amount" IS NOT NULL AND "crm_opportunities"."currency_code" IS NOT NULL)),
	CONSTRAINT "crm_opportunities_probability_check" CHECK ("crm_opportunities"."probability" IS NULL OR ("crm_opportunities"."probability" >= 0 AND "crm_opportunities"."probability" <= 100))
);
--> statement-breakpoint
CREATE TABLE "crm_opportunity_stakeholders" (
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" varchar(80) NOT NULL,
	"influence" varchar(30),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_opportunity_stakeholders_opportunity_id_party_id_role_pk" PRIMARY KEY("opportunity_id","party_id","role")
);
--> statement-breakpoint
CREATE TABLE "crm_opportunity_team" (
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_opportunity_team_opportunity_id_membership_id_role_pk" PRIMARY KEY("opportunity_id","membership_id","role")
);
--> statement-breakpoint
CREATE TABLE "crm_organization_profiles" (
	"party_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"legal_name" varchar(240),
	"website_domain" varchar(255),
	"registration_number" varchar(120),
	"industry" varchar(120),
	"employee_band" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_parties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"legal_entity_id" uuid,
	"business_unit_id" uuid,
	"type" "crm_party_type" NOT NULL,
	"display_name" varchar(240) NOT NULL,
	"normalized_name" varchar(240) NOT NULL,
	"lifecycle" varchar(40) DEFAULT 'prospect' NOT NULL,
	"status" "crm_record_status" DEFAULT 'active' NOT NULL,
	"owner_membership_id" uuid,
	"preferred_locale" varchar(35),
	"preferred_timezone" varchar(64),
	"merged_into_party_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_parties_merge_target_check" CHECK ("crm_parties"."status" <> 'merged' OR "crm_parties"."merged_into_party_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "crm_person_profiles" (
	"party_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"given_name" varchar(120),
	"family_name" varchar(120),
	"honorific" varchar(40),
	"job_title" varchar(160),
	"birthday_month" smallint,
	"birthday_day" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_pipeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"pipeline_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"position" integer NOT NULL,
	"probability" numeric(5, 2) DEFAULT '0' NOT NULL,
	"forecast_category" varchar(40) DEFAULT 'pipeline' NOT NULL,
	"entry_requirements" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_pipeline_stage_probability_check" CHECK ("crm_pipeline_stages"."probability" >= 0 AND "crm_pipeline_stages"."probability" <= 100)
);
--> statement-breakpoint
CREATE TABLE "crm_pipelines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_project_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"mode" varchar(30) DEFAULT 'pre_sales' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"promoted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_qualification_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"service_type" varchar(100),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_qualification_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"label" varchar(240) NOT NULL,
	"data_type" varchar(30) NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"scoring" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_queue_members" (
	"workspace_id" uuid NOT NULL,
	"queue_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"capacity" integer DEFAULT 20 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"territories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unavailable_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_queue_members_queue_id_membership_id_pk" PRIMARY KEY("queue_id","membership_id"),
	CONSTRAINT "crm_queue_members_capacity_check" CHECK ("crm_queue_members"."capacity" > 0 AND "crm_queue_members"."weight" > 0)
);
--> statement-breakpoint
CREATE TABLE "crm_queues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"business_unit_id" uuid,
	"code" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"round_robin_cursor" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_party_id" uuid NOT NULL,
	"to_party_id" uuid NOT NULL,
	"type" varchar(80) NOT NULL,
	"label" varchar(120),
	"is_primary" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_relationships_not_self_check" CHECK ("crm_relationships"."from_party_id" <> "crm_relationships"."to_party_id")
);
--> statement-breakpoint
CREATE TABLE "crm_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"name" varchar(160) NOT NULL,
	"owner_membership_id" uuid,
	"is_shared" boolean DEFAULT false NOT NULL,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"lead_id" uuid,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone,
	"exit_reason" varchar(80),
	"enrolled_by" uuid,
	"exited_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" varchar(40) NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"exit_conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sla_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"lead_id" uuid,
	"target_type" varchar(60) NOT NULL,
	"target_id" uuid NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"warning_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"warned_at" timestamp with time zone,
	"breached_at" timestamp with time zone,
	"stopped_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_sla_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"warning_after_minutes" integer NOT NULL,
	"breach_after_minutes" integer NOT NULL,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_sla_policy_minutes_check" CHECK ("crm_sla_policies"."warning_after_minutes" >= 0 AND "crm_sla_policies"."breach_after_minutes" > "crm_sla_policies"."warning_after_minutes")
);
--> statement-breakpoint
CREATE TABLE "crm_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage_id" uuid,
	"to_stage_id" uuid,
	"from_status" "crm_opportunity_status",
	"to_status" "crm_opportunity_status" NOT NULL,
	"reason" text,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_taxonomies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_taxonomy_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"taxonomy_id" uuid NOT NULL,
	"code" varchar(80) NOT NULL,
	"label" varchar(160) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(30) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"encrypted_token_reference" varchar(500) NOT NULL,
	"locale" varchar(35) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"provider" varchar(60) NOT NULL,
	"status" varchar(30) NOT NULL,
	"provider_message_id" varchar(500),
	"error_code" varchar(120),
	"error_message" text,
	"retry_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"name" varchar(160) NOT NULL,
	"channels" jsonb NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quiet_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frequency_limit" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipient_type" varchar(30) NOT NULL,
	"recipient_id" uuid NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"channel" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"quiet_hours" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" varchar(100) NOT NULL,
	"channel" varchar(40) NOT NULL,
	"locale" varchar(35) NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"status" varchar(30) DEFAULT 'draft' NOT NULL,
	"subject_template" text,
	"body_template" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_template_id" varchar(255),
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_id" uuid,
	"template_id" uuid,
	"recipient_type" varchar(30) NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" varchar(40) NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"deep_link" text,
	"idempotency_key" varchar(160) NOT NULL,
	"correlation_id" uuid NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"suppressed_reason" varchar(120),
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_requested_from_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("requested_from_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_approvals" ADD CONSTRAINT "automation_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_definitions" ADD CONSTRAINT "automation_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_definitions" ADD CONSTRAINT "automation_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_definition_id_automation_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."automation_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_version_id_automation_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."automation_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_step_runs" ADD CONSTRAINT "automation_step_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_step_runs" ADD CONSTRAINT "automation_step_runs_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_definition_id_automation_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."automation_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_waits" ADD CONSTRAINT "automation_waits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_waits" ADD CONSTRAINT "automation_waits_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_activities" ADD CONSTRAINT "crm_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_addresses" ADD CONSTRAINT "crm_addresses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_addresses" ADD CONSTRAINT "crm_addresses_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_appointments" ADD CONSTRAINT "crm_appointments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_appointments" ADD CONSTRAINT "crm_appointments_activity_id_crm_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."crm_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_previous_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("previous_owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_queue_id_crm_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."crm_queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_rule_id_crm_assignment_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."crm_assignment_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_history" ADD CONSTRAINT "crm_assignment_history_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_policies" ADD CONSTRAINT "crm_assignment_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_policies" ADD CONSTRAINT "crm_assignment_policies_fallback_queue_id_crm_queues_id_fk" FOREIGN KEY ("fallback_queue_id") REFERENCES "public"."crm_queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_rules" ADD CONSTRAINT "crm_assignment_rules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_rules" ADD CONSTRAINT "crm_assignment_rules_policy_id_crm_assignment_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."crm_assignment_policies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_assignment_rules" ADD CONSTRAINT "crm_assignment_rules_queue_id_crm_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."crm_queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_attribution_touches" ADD CONSTRAINT "crm_attribution_touches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_attribution_touches" ADD CONSTRAINT "crm_attribution_touches_enquiry_id_crm_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."crm_enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_consents" ADD CONSTRAINT "crm_consents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_consents" ADD CONSTRAINT "crm_consents_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_consents" ADD CONSTRAINT "crm_consents_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact_points" ADD CONSTRAINT "crm_contact_points_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_contact_points" ADD CONSTRAINT "crm_contact_points_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversation_participants" ADD CONSTRAINT "crm_conversation_participants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversation_participants" ADD CONSTRAINT "crm_conversation_participants_conversation_id_crm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."crm_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_conversations" ADD CONSTRAINT "crm_conversations_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_custom_field_definitions" ADD CONSTRAINT "crm_custom_field_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_custom_field_values" ADD CONSTRAINT "crm_custom_field_values_definition_id_crm_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."crm_custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_enquiries" ADD CONSTRAINT "crm_enquiries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_enquiries" ADD CONSTRAINT "crm_enquiries_intake_event_id_crm_intake_events_id_fk" FOREIGN KEY ("intake_event_id") REFERENCES "public"."crm_intake_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_enquiries" ADD CONSTRAINT "crm_enquiries_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_forecast_snapshots" ADD CONSTRAINT "crm_forecast_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_forecast_snapshots" ADD CONSTRAINT "crm_forecast_snapshots_opportunity_id_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_forecast_snapshots" ADD CONSTRAINT "crm_forecast_snapshots_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_forecast_snapshots" ADD CONSTRAINT "crm_forecast_snapshots_stage_id_crm_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_identity_candidates" ADD CONSTRAINT "crm_identity_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_identity_candidates" ADD CONSTRAINT "crm_identity_candidates_intake_event_id_crm_intake_events_id_fk" FOREIGN KEY ("intake_event_id") REFERENCES "public"."crm_intake_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_identity_candidates" ADD CONSTRAINT "crm_identity_candidates_candidate_party_id_crm_parties_id_fk" FOREIGN KEY ("candidate_party_id") REFERENCES "public"."crm_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_identity_candidates" ADD CONSTRAINT "crm_identity_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_intake_events" ADD CONSTRAINT "crm_intake_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_intake_events" ADD CONSTRAINT "crm_intake_events_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_intake_events" ADD CONSTRAINT "crm_intake_events_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_intake_events" ADD CONSTRAINT "crm_intake_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_qualification_values" ADD CONSTRAINT "crm_lead_qualification_values_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_qualification_values" ADD CONSTRAINT "crm_lead_qualification_values_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_lead_qualification_values" ADD CONSTRAINT "crm_lead_qualification_values_captured_by_users_id_fk" FOREIGN KEY ("captured_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_enquiry_id_crm_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."crm_enquiries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_queue_id_crm_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."crm_queues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_merge_operations" ADD CONSTRAINT "crm_merge_operations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_merge_operations" ADD CONSTRAINT "crm_merge_operations_survivor_party_id_crm_parties_id_fk" FOREIGN KEY ("survivor_party_id") REFERENCES "public"."crm_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_merge_operations" ADD CONSTRAINT "crm_merge_operations_merged_party_id_crm_parties_id_fk" FOREIGN KEY ("merged_party_id") REFERENCES "public"."crm_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_merge_operations" ADD CONSTRAINT "crm_merge_operations_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_merge_operations" ADD CONSTRAINT "crm_merge_operations_reversed_by_users_id_fk" FOREIGN KEY ("reversed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_message_attachments" ADD CONSTRAINT "crm_message_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_message_attachments" ADD CONSTRAINT "crm_message_attachments_message_id_crm_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."crm_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_messages" ADD CONSTRAINT "crm_messages_conversation_id_crm_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."crm_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_pipeline_id_crm_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_stage_id_crm_pipeline_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."crm_pipeline_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunities" ADD CONSTRAINT "crm_opportunities_reporting_currency_code_currencies_code_fk" FOREIGN KEY ("reporting_currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_stakeholders" ADD CONSTRAINT "crm_opportunity_stakeholders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_stakeholders" ADD CONSTRAINT "crm_opportunity_stakeholders_opportunity_id_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_stakeholders" ADD CONSTRAINT "crm_opportunity_stakeholders_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_team" ADD CONSTRAINT "crm_opportunity_team_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_team" ADD CONSTRAINT "crm_opportunity_team_opportunity_id_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_opportunity_team" ADD CONSTRAINT "crm_opportunity_team_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organization_profiles" ADD CONSTRAINT "crm_organization_profiles_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_organization_profiles" ADD CONSTRAINT "crm_organization_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_parties" ADD CONSTRAINT "crm_parties_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_parties" ADD CONSTRAINT "crm_parties_legal_entity_id_legal_entities_id_fk" FOREIGN KEY ("legal_entity_id") REFERENCES "public"."legal_entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_parties" ADD CONSTRAINT "crm_parties_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_parties" ADD CONSTRAINT "crm_parties_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_parties" ADD CONSTRAINT "crm_parties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_person_profiles" ADD CONSTRAINT "crm_person_profiles_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_person_profiles" ADD CONSTRAINT "crm_person_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipeline_stages" ADD CONSTRAINT "crm_pipeline_stages_pipeline_id_crm_pipelines_id_fk" FOREIGN KEY ("pipeline_id") REFERENCES "public"."crm_pipelines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_pipelines" ADD CONSTRAINT "crm_pipelines_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_links" ADD CONSTRAINT "crm_project_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_project_links" ADD CONSTRAINT "crm_project_links_opportunity_id_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_qualification_forms" ADD CONSTRAINT "crm_qualification_forms_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_qualification_questions" ADD CONSTRAINT "crm_qualification_questions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_qualification_questions" ADD CONSTRAINT "crm_qualification_questions_form_id_crm_qualification_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."crm_qualification_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_queue_members" ADD CONSTRAINT "crm_queue_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_queue_members" ADD CONSTRAINT "crm_queue_members_queue_id_crm_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."crm_queues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_queue_members" ADD CONSTRAINT "crm_queue_members_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_queues" ADD CONSTRAINT "crm_queues_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_queues" ADD CONSTRAINT "crm_queues_business_unit_id_business_units_id_fk" FOREIGN KEY ("business_unit_id") REFERENCES "public"."business_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_relationships" ADD CONSTRAINT "crm_relationships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_relationships" ADD CONSTRAINT "crm_relationships_from_party_id_crm_parties_id_fk" FOREIGN KEY ("from_party_id") REFERENCES "public"."crm_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_relationships" ADD CONSTRAINT "crm_relationships_to_party_id_crm_parties_id_fk" FOREIGN KEY ("to_party_id") REFERENCES "public"."crm_parties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_owner_membership_id_workspace_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."workspace_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_enrollments" ADD CONSTRAINT "crm_sequence_enrollments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_enrollments" ADD CONSTRAINT "crm_sequence_enrollments_sequence_id_crm_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."crm_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_enrollments" ADD CONSTRAINT "crm_sequence_enrollments_party_id_crm_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."crm_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_enrollments" ADD CONSTRAINT "crm_sequence_enrollments_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_enrollments" ADD CONSTRAINT "crm_sequence_enrollments_enrolled_by_users_id_fk" FOREIGN KEY ("enrolled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_steps" ADD CONSTRAINT "crm_sequence_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequence_steps" ADD CONSTRAINT "crm_sequence_steps_sequence_id_crm_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."crm_sequences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequences" ADD CONSTRAINT "crm_sequences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sequences" ADD CONSTRAINT "crm_sequences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sla_instances" ADD CONSTRAINT "crm_sla_instances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sla_instances" ADD CONSTRAINT "crm_sla_instances_policy_id_crm_sla_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."crm_sla_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sla_instances" ADD CONSTRAINT "crm_sla_instances_lead_id_crm_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_sla_policies" ADD CONSTRAINT "crm_sla_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_opportunity_id_crm_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_from_stage_id_crm_pipeline_stages_id_fk" FOREIGN KEY ("from_stage_id") REFERENCES "public"."crm_pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_to_stage_id_crm_pipeline_stages_id_fk" FOREIGN KEY ("to_stage_id") REFERENCES "public"."crm_pipeline_stages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_stage_history" ADD CONSTRAINT "crm_stage_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_taxonomies" ADD CONSTRAINT "crm_taxonomies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_taxonomy_options" ADD CONSTRAINT "crm_taxonomy_options_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_taxonomy_options" ADD CONSTRAINT "crm_taxonomy_options_taxonomy_id_crm_taxonomies_id_fk" FOREIGN KEY ("taxonomy_id") REFERENCES "public"."crm_taxonomies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_endpoints" ADD CONSTRAINT "device_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_endpoints" ADD CONSTRAINT "device_endpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_policies" ADD CONSTRAINT "notification_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_policy_id_notification_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."notification_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_template_id_notification_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_approvals_pending_idx" ON "automation_approvals" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_definitions_code_uidx" ON "automation_definitions" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_trigger_uidx" ON "automation_runs" USING btree ("workspace_id","definition_id","trigger_event_id","aggregate_id");--> statement-breakpoint
CREATE INDEX "automation_runs_status_idx" ON "automation_runs" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_step_runs_attempt_uidx" ON "automation_step_runs" USING btree ("workspace_id","run_id","step_key","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_versions_number_uidx" ON "automation_versions" USING btree ("workspace_id","definition_id","version_number");--> statement-breakpoint
CREATE INDEX "automation_waits_due_idx" ON "automation_waits" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "crm_activities_owner_due_idx" ON "crm_activities" USING btree ("workspace_id","owner_membership_id","status","due_at");--> statement-breakpoint
CREATE INDEX "crm_activities_lead_idx" ON "crm_activities" USING btree ("workspace_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_activities_party_idx" ON "crm_activities" USING btree ("workspace_id","party_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_addresses_party_idx" ON "crm_addresses" USING btree ("workspace_id","party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_appointments_activity_uidx" ON "crm_appointments" USING btree ("workspace_id","activity_id");--> statement-breakpoint
CREATE INDEX "crm_assignment_history_lead_idx" ON "crm_assignment_history" USING btree ("workspace_id","lead_id","assigned_at");--> statement-breakpoint
CREATE INDEX "crm_assignment_policies_priority_idx" ON "crm_assignment_policies" USING btree ("workspace_id","status","priority");--> statement-breakpoint
CREATE INDEX "crm_assignment_rules_policy_idx" ON "crm_assignment_rules" USING btree ("workspace_id","policy_id","priority");--> statement-breakpoint
CREATE INDEX "crm_attribution_enquiry_idx" ON "crm_attribution_touches" USING btree ("workspace_id","enquiry_id","touched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_consents_scope_uidx" ON "crm_consents" USING btree ("workspace_id","party_id","legal_entity_id","purpose","channel");--> statement-breakpoint
CREATE INDEX "crm_consents_party_idx" ON "crm_consents" USING btree ("workspace_id","party_id");--> statement-breakpoint
CREATE INDEX "crm_contact_points_party_idx" ON "crm_contact_points" USING btree ("workspace_id","party_id");--> statement-breakpoint
CREATE INDEX "crm_contact_points_normalized_idx" ON "crm_contact_points" USING btree ("workspace_id","type","normalized_value");--> statement-breakpoint
CREATE INDEX "crm_conversations_owner_idx" ON "crm_conversations" USING btree ("workspace_id","owner_membership_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_conversations_provider_uidx" ON "crm_conversations" USING btree ("workspace_id","channel","provider_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_custom_field_definitions_key_uidx" ON "crm_custom_field_definitions" USING btree ("workspace_id","entity_type","key");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_custom_field_values_entity_uidx" ON "crm_custom_field_values" USING btree ("workspace_id","definition_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "crm_custom_field_values_text_idx" ON "crm_custom_field_values" USING btree ("workspace_id","definition_id","value_text");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_enquiries_intake_uidx" ON "crm_enquiries" USING btree ("workspace_id","intake_event_id");--> statement-breakpoint
CREATE INDEX "crm_enquiries_party_idx" ON "crm_enquiries" USING btree ("workspace_id","party_id","received_at");--> statement-breakpoint
CREATE INDEX "crm_forecast_snapshots_time_idx" ON "crm_forecast_snapshots" USING btree ("workspace_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_identity_candidate_uidx" ON "crm_identity_candidates" USING btree ("workspace_id","intake_event_id","candidate_party_id");--> statement-breakpoint
CREATE INDEX "crm_identity_candidate_review_idx" ON "crm_identity_candidates" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_intake_events_idempotency_uidx" ON "crm_intake_events" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_intake_events_external_uidx" ON "crm_intake_events" USING btree ("workspace_id","source","external_event_id");--> statement-breakpoint
CREATE INDEX "crm_intake_events_inbox_idx" ON "crm_intake_events" USING btree ("workspace_id","status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_lead_qualification_value_uidx" ON "crm_lead_qualification_values" USING btree ("workspace_id","lead_id","question_key");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_leads_enquiry_uidx" ON "crm_leads" USING btree ("workspace_id","enquiry_id");--> statement-breakpoint
CREATE INDEX "crm_leads_owner_status_idx" ON "crm_leads" USING btree ("workspace_id","owner_membership_id","status");--> statement-breakpoint
CREATE INDEX "crm_leads_queue_status_idx" ON "crm_leads" USING btree ("workspace_id","queue_id","status");--> statement-breakpoint
CREATE INDEX "crm_leads_next_action_idx" ON "crm_leads" USING btree ("workspace_id","next_action_at");--> statement-breakpoint
CREATE INDEX "crm_merge_operations_party_idx" ON "crm_merge_operations" USING btree ("workspace_id","survivor_party_id","merged_party_id");--> statement-breakpoint
CREATE INDEX "crm_message_attachments_message_idx" ON "crm_message_attachments" USING btree ("workspace_id","message_id");--> statement-breakpoint
CREATE INDEX "crm_messages_conversation_idx" ON "crm_messages" USING btree ("workspace_id","conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_messages_provider_uidx" ON "crm_messages" USING btree ("workspace_id","provider_message_id");--> statement-breakpoint
CREATE INDEX "crm_opportunities_stage_idx" ON "crm_opportunities" USING btree ("workspace_id","pipeline_id","stage_id","status");--> statement-breakpoint
CREATE INDEX "crm_opportunities_owner_idx" ON "crm_opportunities" USING btree ("workspace_id","owner_membership_id","status");--> statement-breakpoint
CREATE INDEX "crm_opportunities_party_idx" ON "crm_opportunities" USING btree ("workspace_id","party_id","created_at");--> statement-breakpoint
CREATE INDEX "crm_parties_workspace_name_idx" ON "crm_parties" USING btree ("workspace_id","normalized_name");--> statement-breakpoint
CREATE INDEX "crm_parties_workspace_owner_idx" ON "crm_parties" USING btree ("workspace_id","owner_membership_id");--> statement-breakpoint
CREATE INDEX "crm_parties_workspace_lifecycle_idx" ON "crm_parties" USING btree ("workspace_id","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipeline_stages_code_uidx" ON "crm_pipeline_stages" USING btree ("workspace_id","pipeline_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipeline_stages_position_uidx" ON "crm_pipeline_stages" USING btree ("workspace_id","pipeline_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_pipelines_code_uidx" ON "crm_pipelines" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_project_links_opportunity_uidx" ON "crm_project_links" USING btree ("workspace_id","opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_project_links_project_uidx" ON "crm_project_links" USING btree ("workspace_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_qualification_forms_code_uidx" ON "crm_qualification_forms" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_qualification_questions_key_uidx" ON "crm_qualification_questions" USING btree ("workspace_id","form_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_qualification_questions_position_uidx" ON "crm_qualification_questions" USING btree ("workspace_id","form_id","position");--> statement-breakpoint
CREATE INDEX "crm_queue_members_member_idx" ON "crm_queue_members" USING btree ("workspace_id","membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_queues_code_uidx" ON "crm_queues" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE INDEX "crm_queues_fallback_idx" ON "crm_queues" USING btree ("workspace_id","is_fallback");--> statement-breakpoint
CREATE INDEX "crm_relationships_from_idx" ON "crm_relationships" USING btree ("workspace_id","from_party_id");--> statement-breakpoint
CREATE INDEX "crm_relationships_to_idx" ON "crm_relationships" USING btree ("workspace_id","to_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_relationships_unique_uidx" ON "crm_relationships" USING btree ("workspace_id","from_party_id","to_party_id","type");--> statement-breakpoint
CREATE INDEX "crm_saved_views_owner_idx" ON "crm_saved_views" USING btree ("workspace_id","entity_type","owner_membership_id");--> statement-breakpoint
CREATE INDEX "crm_sequence_enrollments_due_idx" ON "crm_sequence_enrollments" USING btree ("workspace_id","status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_sequence_steps_position_uidx" ON "crm_sequence_steps" USING btree ("workspace_id","sequence_id","position");--> statement-breakpoint
CREATE INDEX "crm_sequences_status_idx" ON "crm_sequences" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "crm_sla_instances_due_idx" ON "crm_sla_instances" USING btree ("workspace_id","status","due_at");--> statement-breakpoint
CREATE INDEX "crm_stage_history_opportunity_idx" ON "crm_stage_history" USING btree ("workspace_id","opportunity_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_taxonomies_code_uidx" ON "crm_taxonomies" USING btree ("workspace_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_taxonomy_options_code_uidx" ON "crm_taxonomy_options" USING btree ("workspace_id","taxonomy_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "device_endpoints_token_uidx" ON "device_endpoints" USING btree ("workspace_id","token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_delivery_attempt_uidx" ON "notification_delivery_attempts" USING btree ("workspace_id","notification_id","attempt");--> statement-breakpoint
CREATE INDEX "notification_policies_event_idx" ON "notification_policies" USING btree ("workspace_id","event_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_scope_uidx" ON "notification_preferences" USING btree ("workspace_id","recipient_type","recipient_id","event_type","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_templates_version_uidx" ON "notification_templates" USING btree ("workspace_id","code","channel","locale","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_idempotency_uidx" ON "notifications" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "notifications_delivery_idx" ON "notifications" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("workspace_id","recipient_type","recipient_id","created_at");