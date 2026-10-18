CREATE TABLE "local_auth_credentials" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "password_hash" varchar(128) NOT NULL,
  "password_salt" varchar(64) NOT NULL,
  "failed_attempts" integer DEFAULT 0 NOT NULL,
  "locked_until" timestamp with time zone,
  "password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "local_auth_credentials"
  ADD CONSTRAINT "local_auth_credentials_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "auth_refresh_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "family_id" uuid NOT NULL,
  "token_hash" char(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "replaced_by_session_id" uuid,
  "user_agent" text,
  "ip_address" varchar(64),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_refresh_sessions"
  ADD CONSTRAINT "auth_refresh_sessions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
ALTER TABLE "auth_refresh_sessions"
  ADD CONSTRAINT "auth_refresh_sessions_replaced_by_session_id_fk"
  FOREIGN KEY ("replaced_by_session_id") REFERENCES "public"."auth_refresh_sessions"("id")
  ON DELETE set null ON UPDATE no action;
CREATE UNIQUE INDEX "auth_refresh_sessions_token_uidx" ON "auth_refresh_sessions" ("token_hash");
CREATE INDEX "auth_refresh_sessions_user_idx" ON "auth_refresh_sessions" ("user_id");
CREATE INDEX "auth_refresh_sessions_family_idx" ON "auth_refresh_sessions" ("family_id");
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "token_hash" char(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "password_reset_tokens_token_uidx" ON "password_reset_tokens" ("token_hash");
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" ("user_id");
--> statement-breakpoint
CREATE TABLE "tenant_login_branding" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "login_slug" varchar(80) NOT NULL,
  "display_name" varchar(160) NOT NULL,
  "logo_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_login_branding"
  ADD CONSTRAINT "tenant_login_branding_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "tenant_login_branding_slug_uidx" ON "tenant_login_branding" ("login_slug");
--> statement-breakpoint
INSERT INTO "tenant_login_branding" ("workspace_id", "login_slug", "display_name")
SELECT "id", "slug", "name" FROM "workspaces"
ON CONFLICT ("workspace_id") DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "local_auth_credentials"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "tenant_login_branding"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
