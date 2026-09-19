CREATE TABLE "workspace_domains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "hostname" varchar(253) NOT NULL,
  "request_key" varchar(160) NOT NULL,
  "challenge_value" varchar(96) NOT NULL,
  "challenge_expires_at" timestamp with time zone NOT NULL,
  "dns_status" varchar(20) DEFAULT 'pending' NOT NULL,
  "dns_verified_at" timestamp with time zone,
  "certificate_status" varchar(24) DEFAULT 'not_requested' NOT NULL,
  "certificate_expires_at" timestamp with time zone,
  "routing_status" varchar(20) DEFAULT 'not_requested' NOT NULL,
  "routing_activated_at" timestamp with time zone,
  "rollback_status" varchar(20) DEFAULT 'none' NOT NULL,
  "last_error_code" varchar(80),
  "version" integer DEFAULT 1 NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "users"("id"),
  "removed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_domains_dns_status_check" CHECK ("dns_status" IN ('pending', 'verified', 'expired', 'failed')),
  CONSTRAINT "workspace_domains_certificate_status_check" CHECK ("certificate_status" IN ('not_requested', 'manual_setup_required', 'pending', 'issued', 'expired', 'failed')),
  CONSTRAINT "workspace_domains_routing_status_check" CHECK ("routing_status" IN ('not_requested', 'pending', 'active', 'failed')),
  CONSTRAINT "workspace_domains_rollback_status_check" CHECK ("rollback_status" IN ('none', 'pending', 'completed', 'failed')),
  CONSTRAINT "workspace_domains_version_check" CHECK ("version" > 0),
  CONSTRAINT "workspace_domains_activation_check" CHECK ("routing_status" <> 'active' OR ("dns_status" = 'verified' AND "certificate_status" = 'issued' AND "routing_activated_at" IS NOT NULL AND "removed_at" IS NULL)),
  CONSTRAINT "workspace_domains_certificate_check" CHECK ("certificate_status" NOT IN ('pending', 'issued') OR "dns_status" = 'verified')
);
CREATE UNIQUE INDEX "workspace_domains_live_hostname_uidx" ON "workspace_domains" ("hostname") WHERE "removed_at" IS NULL;
CREATE UNIQUE INDEX "workspace_domains_request_key_uidx" ON "workspace_domains" ("workspace_id", "request_key");
CREATE INDEX "workspace_domains_workspace_idx" ON "workspace_domains" ("workspace_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE "workspace_domains" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_domains" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_domains"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workspace_domains TO wodana_app;
  END IF;
END $$;
