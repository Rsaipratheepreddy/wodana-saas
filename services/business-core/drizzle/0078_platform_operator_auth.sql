CREATE TABLE "platform_operator_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" char(64) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "purpose" varchar(20) NOT NULL,
  "credential_changed_at" timestamp with time zone NOT NULL,
  "mfa_session_version" integer NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "ip_address" varchar(64),
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_operator_challenges_purpose_check" CHECK ("purpose" IN ('login', 'enroll')),
  CONSTRAINT "platform_operator_challenges_attempts_check" CHECK ("failed_attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 20),
  CONSTRAINT "platform_operator_challenges_mfa_version_check" CHECK ("mfa_session_version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_operator_challenges_token_uidx" ON "platform_operator_challenges" ("token_hash");
CREATE INDEX "platform_operator_challenges_user_idx" ON "platform_operator_challenges" ("user_id", "consumed_at", "expires_at");
--> statement-breakpoint
CREATE TABLE "platform_operator_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" char(64) NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "credential_changed_at" timestamp with time zone NOT NULL,
  "mfa_session_version" integer NOT NULL,
  "mfa_verified_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "ip_address" varchar(64),
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_operator_sessions_mfa_version_check" CHECK ("mfa_session_version" >= 0)
);
CREATE UNIQUE INDEX "platform_operator_sessions_token_uidx" ON "platform_operator_sessions" ("token_hash");
CREATE INDEX "platform_operator_sessions_user_idx" ON "platform_operator_sessions" ("user_id", "revoked_at", "expires_at");
--> statement-breakpoint
CREATE TABLE "platform_operator_audit" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid REFERENCES "public"."users"("id") ON DELETE set null,
  "action" varchar(100) NOT NULL,
  "target_type" varchar(60),
  "target_id" varchar(120),
  "correlation_id" varchar(120),
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_operator_audit_details_check" CHECK (jsonb_typeof("details") = 'object')
);
CREATE INDEX "platform_operator_audit_actor_created_idx" ON "platform_operator_audit" ("actor_user_id", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_operator_challenges TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_operator_sessions TO wodana_app;
    GRANT SELECT, INSERT ON platform_operator_audit TO wodana_app;
  END IF;
END $$;
