CREATE TABLE "workspace_invitation_delivery_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "invitation_id" uuid NOT NULL REFERENCES "workspace_invitations"("id") ON DELETE cascade,
  "idempotency_key" varchar(160) NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "provider_message_id" varchar(255),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_invitation_delivery_commands_status_check" CHECK ("status" IN ('pending', 'sent', 'not_configured', 'failed', 'superseded'))
);
CREATE UNIQUE INDEX "workspace_invitation_delivery_commands_key_uidx"
  ON "workspace_invitation_delivery_commands" ("invitation_id", "idempotency_key");
--> statement-breakpoint
ALTER TABLE "workspace_invitation_delivery_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_invitation_delivery_commands" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_invitation_delivery_commands"
  USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workspace_invitation_delivery_commands TO wodana_app;
  END IF;
END $$;
