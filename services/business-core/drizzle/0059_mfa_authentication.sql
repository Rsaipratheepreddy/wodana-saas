ALTER TABLE "users"
  ADD COLUMN "mfa_session_version" integer DEFAULT 0 NOT NULL,
  ADD CONSTRAINT "users_mfa_session_version_check" CHECK ("mfa_session_version" >= 0);
--> statement-breakpoint

ALTER TABLE "customer_accounts"
  ADD COLUMN "security_policy" jsonb DEFAULT '{
    "requireMfaForAdmins": true,
    "requireMfaForAllUsers": false,
    "recoveryCodeCount": 10,
    "enrollmentGraceDays": 7
  }'::jsonb NOT NULL,
  ADD CONSTRAINT "customer_accounts_security_policy_check" CHECK (
    jsonb_typeof("security_policy") = 'object'
    AND jsonb_typeof("security_policy"->'requireMfaForAdmins') = 'boolean'
    AND jsonb_typeof("security_policy"->'requireMfaForAllUsers') = 'boolean'
    AND ("security_policy"->>'recoveryCodeCount')::integer BETWEEN 5 AND 20
    AND ("security_policy"->>'enrollmentGraceDays')::integer BETWEEN 0 AND 30
  );
--> statement-breakpoint

ALTER TABLE "auth_refresh_sessions"
  ADD COLUMN "authentication_methods" jsonb DEFAULT '["pwd"]'::jsonb NOT NULL,
  ADD COLUMN "mfa_verified_at" timestamp with time zone,
  ADD COLUMN "mfa_session_version" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "mfa_enrollment_deadline" timestamp with time zone,
  ADD CONSTRAINT "auth_refresh_sessions_authentication_methods_check"
    CHECK (jsonb_typeof("authentication_methods") = 'array'),
  ADD CONSTRAINT "auth_refresh_sessions_mfa_session_version_check"
    CHECK ("mfa_session_version" >= 0);
--> statement-breakpoint

CREATE TABLE "user_mfa_credentials" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "encrypted_totp_secret" text NOT NULL,
  "encryption_nonce" varchar(32) NOT NULL,
  "encryption_auth_tag" varchar(32) NOT NULL,
  "encryption_key_version" integer DEFAULT 1 NOT NULL,
  "setup_expires_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone,
  "disabled_at" timestamp with time zone,
  "last_used_step" bigint,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_mfa_credentials_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "user_mfa_credentials_key_version_check" CHECK ("encryption_key_version" > 0),
  CONSTRAINT "user_mfa_credentials_failed_attempts_check" CHECK ("failed_attempts" >= 0),
  CONSTRAINT "user_mfa_credentials_state_check" CHECK (
    NOT ("confirmed_at" IS NOT NULL AND "disabled_at" IS NOT NULL)
  )
);
--> statement-breakpoint

CREATE TABLE "user_mfa_recovery_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "code_hash" char(64) NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "user_mfa_recovery_codes_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user_mfa_credentials"("user_id") ON DELETE cascade
);
CREATE UNIQUE INDEX "user_mfa_recovery_codes_user_hash_uidx"
  ON "user_mfa_recovery_codes" ("user_id", "code_hash");
CREATE INDEX "user_mfa_recovery_codes_available_idx"
  ON "user_mfa_recovery_codes" ("user_id", "used_at");
--> statement-breakpoint

CREATE TABLE "mfa_enrollment_requirements" (
  "user_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "required_since" timestamp with time zone DEFAULT now() NOT NULL,
  "grace_expires_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mfa_enrollment_requirements_pk" PRIMARY KEY ("user_id", "account_id"),
  CONSTRAINT "mfa_enrollment_requirements_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "mfa_enrollment_requirements_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade,
  CONSTRAINT "mfa_enrollment_requirements_grace_check"
    CHECK ("grace_expires_at" >= "required_since")
);
CREATE INDEX "mfa_enrollment_requirements_account_idx"
  ON "mfa_enrollment_requirements" ("account_id", "resolved_at");
--> statement-breakpoint

CREATE TABLE "auth_mfa_challenges" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" char(64) NOT NULL,
  "user_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "purpose" varchar(20) DEFAULT 'login' NOT NULL,
  "credential_changed_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 5 NOT NULL,
  "ip_address" varchar(64),
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "auth_mfa_challenges_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "auth_mfa_challenges_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "auth_mfa_challenges_purpose_check" CHECK ("purpose" IN ('login')),
  CONSTRAINT "auth_mfa_challenges_attempts_check"
    CHECK ("failed_attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 20)
);
CREATE UNIQUE INDEX "auth_mfa_challenges_token_uidx" ON "auth_mfa_challenges" ("token_hash");
CREATE INDEX "auth_mfa_challenges_active_idx"
  ON "auth_mfa_challenges" ("user_id", "consumed_at", "expires_at");
--> statement-breakpoint

CREATE TABLE "mfa_security_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid,
  "workspace_id" uuid,
  "event_type" varchar(80) NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ip_address" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "mfa_security_events_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "mfa_security_events_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null,
  CONSTRAINT "mfa_security_events_metadata_check" CHECK (jsonb_typeof("metadata") = 'object')
);
CREATE INDEX "mfa_security_events_user_created_idx"
  ON "mfa_security_events" ("user_id", "created_at");
CREATE INDEX "mfa_security_events_workspace_created_idx"
  ON "mfa_security_events" ("workspace_id", "created_at");
--> statement-breakpoint

-- Existing authenticated users must receive the same grace policy as the next sign-in.
-- Account administrators are identified both by account role and by an administrator role in
-- any organization, because organization membership never grants account-wide data access.
WITH required_users AS (
  SELECT account.id AS account_id, member.user_id,
         (account.security_policy->>'enrollmentGraceDays')::integer AS grace_days
  FROM customer_accounts account
  JOIN customer_account_memberships member ON member.account_id = account.id
  WHERE account.status = 'active' AND member.status = 'active'
    AND (
      (account.security_policy->>'requireMfaForAllUsers')::boolean
      OR (
        (account.security_policy->>'requireMfaForAdmins')::boolean
        AND member.role IN ('owner', 'administrator')
      )
    )
  UNION
  SELECT account.id, membership.user_id,
         (account.security_policy->>'enrollmentGraceDays')::integer
  FROM customer_accounts account
  JOIN customer_account_organizations linked ON linked.account_id = account.id
  JOIN workspace_memberships membership ON membership.workspace_id = linked.workspace_id
  JOIN member_roles assigned ON assigned.membership_id = membership.id
  JOIN roles role ON role.id = assigned.role_id
  WHERE account.status = 'active' AND membership.status = 'active'
    AND (account.security_policy->>'requireMfaForAdmins')::boolean
    AND role.code IN ('owner', 'administrator')
)
INSERT INTO mfa_enrollment_requirements (user_id, account_id, grace_expires_at)
SELECT user_id, account_id, now() + make_interval(days => grace_days)
FROM required_users
ON CONFLICT (user_id, account_id) DO NOTHING;
--> statement-breakpoint

UPDATE auth_refresh_sessions session
SET mfa_enrollment_deadline = requirement.grace_expires_at
FROM (
  SELECT user_id, min(grace_expires_at) AS grace_expires_at
  FROM mfa_enrollment_requirements
  WHERE resolved_at IS NULL
  GROUP BY user_id
) requirement
WHERE session.user_id = requirement.user_id
  AND session.revoked_at IS NULL
  AND session.expires_at > now();
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "user_mfa_credentials"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "mfa_enrollment_requirements"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "auth_mfa_challenges"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_mfa_credentials TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_mfa_recovery_codes TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_enrollment_requirements TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON auth_mfa_challenges TO wodana_app;
    GRANT SELECT, INSERT ON mfa_security_events TO wodana_app;
  END IF;
END $$;
