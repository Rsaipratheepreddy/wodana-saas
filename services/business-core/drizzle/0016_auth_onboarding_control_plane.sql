CREATE TYPE "public"."onboarding_status" AS ENUM('not_started', 'in_progress', 'completed');
--> statement-breakpoint
CREATE TABLE "workspace_onboarding" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "status" "onboarding_status" DEFAULT 'not_started' NOT NULL,
  "current_step" varchar(64) DEFAULT 'workspace_profile' NOT NULL,
  "completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_onboarding_step_check"
    CHECK ("current_step" IN ('workspace_profile', 'organization', 'team', 'integrations', 'complete')),
  CONSTRAINT "workspace_onboarding_completed_steps_array_check"
    CHECK (jsonb_typeof("completed_steps") = 'array')
);
--> statement-breakpoint
ALTER TABLE "workspace_onboarding"
  ADD CONSTRAINT "workspace_onboarding_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "tenant_provisioning_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_tenant_id" varchar(160) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" char(64) NOT NULL,
  "workspace_id" uuid NOT NULL,
  "response_body" jsonb NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_provisioning_requests"
  ADD CONSTRAINT "tenant_provisioning_requests_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_provisioning_external_tenant_uidx"
  ON "tenant_provisioning_requests" USING btree ("external_tenant_id");
CREATE UNIQUE INDEX "tenant_provisioning_idempotency_key_uidx"
  ON "tenant_provisioning_requests" USING btree ("idempotency_key");
CREATE UNIQUE INDEX "tenant_provisioning_workspace_uidx"
  ON "tenant_provisioning_requests" USING btree ("workspace_id");
--> statement-breakpoint
-- Existing tenants predate guided onboarding and must remain immediately usable.
INSERT INTO "workspace_onboarding"
  ("workspace_id", "status", "current_step", "completed_steps", "started_at", "completed_at")
SELECT id, 'completed', 'complete',
       '["workspace_profile","organization","team","integrations"]'::jsonb,
       created_at, now()
FROM "workspaces"
ON CONFLICT ("workspace_id") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "workspace_onboarding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_onboarding" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_onboarding"
USING (
  "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
)
WITH CHECK (
  "workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
);
--> statement-breakpoint
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON "workspace_onboarding"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- A signed-in user may discover only invitations sent to the email verified by OIDC.
CREATE POLICY "invitation_email_self_discovery" ON "workspace_invitations"
FOR SELECT
USING (
  "email" = (
    SELECT app_user.primary_email
    FROM "users" app_user
    WHERE app_user.id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid
  )
);
CREATE POLICY "workspace_invitation_self_discovery" ON "workspaces"
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM "workspace_invitations" invitation
    JOIN "users" app_user ON app_user.primary_email = invitation.email
    WHERE invitation.workspace_id = workspaces.id
      AND app_user.id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid
      AND invitation.status = 'pending'
      AND invitation.expires_at > now()
  )
);
