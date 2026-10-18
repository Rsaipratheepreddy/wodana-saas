CREATE TABLE "tenant_setup_profiles" (
  "kind" varchar(20) NOT NULL,
  "code" varchar(40) NOT NULL,
  "version" integer NOT NULL,
  "configuration" jsonb NOT NULL,
  "published_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_setup_profiles_pk" PRIMARY KEY ("kind", "code", "version"),
  CONSTRAINT "tenant_setup_profiles_kind_check" CHECK ("kind" IN ('region', 'firm_kit', 'plan')),
  CONSTRAINT "tenant_setup_profiles_version_check" CHECK ("version" > 0),
  CONSTRAINT "tenant_setup_profiles_configuration_check" CHECK (jsonb_typeof("configuration") = 'object')
);
--> statement-breakpoint
INSERT INTO "tenant_setup_profiles" ("kind", "code", "version", "configuration") VALUES
  ('region', 'AE', 1, '{"countryCode":"AE","currency":"AED","locale":"en-AE","timezone":"Asia/Dubai","unitSystem":"metric","weekStartsOn":1}'::jsonb),
  ('region', 'IN', 1, '{"countryCode":"IN","currency":"INR","locale":"en-IN","timezone":"Asia/Kolkata","unitSystem":"metric","weekStartsOn":1}'::jsonb),
  ('firm_kit', 'design_build', 1, '{"label":"Design & build"}'::jsonb),
  ('firm_kit', 'interior_studio', 1, '{"label":"Interior design studio"}'::jsonb),
  ('firm_kit', 'fitout_contractor', 1, '{"label":"Fit-out contractor"}'::jsonb),
  ('firm_kit', 'joinery_furniture', 1, '{"label":"Joinery / furniture"}'::jsonb),
  ('firm_kit', 'blank', 1, '{"label":"Blank"}'::jsonb),
  ('plan', 'starter', 1, '{"seatLimit":5,"projectLimit":25,"billingCycle":"monthly","status":"trial_default"}'::jsonb);
--> statement-breakpoint
ALTER TABLE "customer_accounts"
  ADD COLUMN "contract_contact_name" varchar(160),
  ADD COLUMN "contract_contact_email" citext;
--> statement-breakpoint
CREATE TABLE "tenant_provisioning_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_tenant_id" varchar(160) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "provision_idempotency_key" varchar(160),
  "request_hash" char(64) NOT NULL,
  "account" jsonb NOT NULL,
  "organization" jsonb NOT NULL,
  "owner" jsonb NOT NULL,
  "defaults" jsonb NOT NULL,
  "slug" varchar(80) NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "reservation_expires_at" timestamp with time zone NOT NULL,
  "workspace_id" uuid REFERENCES "workspaces"("id") ON DELETE set null,
  "last_error_code" varchar(80),
  "created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "updated_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_provisioning_drafts_status_check" CHECK ("status" IN ('draft', 'provisioning', 'provisioned', 'failed', 'expired')),
  CONSTRAINT "tenant_provisioning_drafts_version_check" CHECK ("version" > 0),
  CONSTRAINT "tenant_provisioning_drafts_json_check" CHECK (jsonb_typeof("account") = 'object' AND jsonb_typeof("organization") = 'object' AND jsonb_typeof("owner") = 'object' AND jsonb_typeof("defaults") = 'object')
);
CREATE UNIQUE INDEX "tenant_provisioning_drafts_external_uidx" ON "tenant_provisioning_drafts" ("external_tenant_id");
CREATE UNIQUE INDEX "tenant_provisioning_drafts_key_uidx" ON "tenant_provisioning_drafts" ("idempotency_key");
CREATE UNIQUE INDEX "tenant_provisioning_drafts_provision_key_uidx" ON "tenant_provisioning_drafts" ("provision_idempotency_key") WHERE "provision_idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "tenant_provisioning_drafts_live_slug_uidx" ON "tenant_provisioning_drafts" ("slug") WHERE "status" IN ('draft', 'provisioning', 'failed', 'provisioned');
CREATE INDEX "tenant_provisioning_drafts_status_idx" ON "tenant_provisioning_drafts" ("status", "created_at");
--> statement-breakpoint
CREATE TABLE "workspace_setup_versions" (
  "workspace_id" uuid PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "region_code" varchar(40) NOT NULL,
  "region_version" integer NOT NULL,
  "firm_kit_code" varchar(40) NOT NULL,
  "firm_kit_version" integer NOT NULL,
  "plan_code" varchar(40) NOT NULL,
  "plan_version" integer NOT NULL,
  "configuration_snapshot" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_setup_versions_snapshot_check" CHECK (jsonb_typeof("configuration_snapshot") = 'object')
);
ALTER TABLE "workspace_setup_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_setup_versions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_setup_versions"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "workspace_invitation_delivery" (
  "invitation_id" uuid PRIMARY KEY NOT NULL REFERENCES "workspace_invitations"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "status" varchar(20) DEFAULT 'not_requested' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "provider" varchar(40),
  "provider_message_id" varchar(255),
  "last_attempted_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_invitation_delivery_status_check" CHECK ("status" IN ('not_requested', 'pending', 'sent', 'not_configured', 'failed')),
  CONSTRAINT "workspace_invitation_delivery_attempts_check" CHECK ("attempts" >= 0)
);
ALTER TABLE "workspace_invitation_delivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_invitation_delivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_invitation_delivery"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON tenant_provisioning_drafts TO wodana_app;
    GRANT SELECT ON tenant_setup_profiles TO wodana_app;
    GRANT SELECT, INSERT ON workspace_setup_versions TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON workspace_invitation_delivery TO wodana_app;
  END IF;
END $$;
