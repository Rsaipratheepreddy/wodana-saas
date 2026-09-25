CREATE TABLE "platform_administrators" (
  "user_id" uuid PRIMARY KEY NOT NULL,
  "role" varchar(40) DEFAULT 'administrator' NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_administrators_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "platform_administrators_role_check" CHECK ("role" IN ('administrator')),
  CONSTRAINT "platform_administrators_status_check" CHECK ("status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE TABLE "workspace_subscriptions" (
  "workspace_id" uuid PRIMARY KEY NOT NULL,
  "plan_code" varchar(30) DEFAULT 'starter' NOT NULL,
  "status" varchar(30) DEFAULT 'trial' NOT NULL,
  "billing_cycle" varchar(20) DEFAULT 'monthly' NOT NULL,
  "amount" numeric(12, 2) DEFAULT 0 NOT NULL,
  "currency" char(3) NOT NULL,
  "seat_limit" integer DEFAULT 5 NOT NULL,
  "project_limit" integer DEFAULT 25 NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "renews_at" timestamp with time zone,
  "note" text,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_subscriptions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade,
  CONSTRAINT "workspace_subscriptions_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "workspace_subscriptions_plan_check" CHECK ("plan_code" IN ('starter', 'pro', 'enterprise')),
  CONSTRAINT "workspace_subscriptions_status_check" CHECK ("status" IN ('trial', 'active', 'past_due', 'cancelled')),
  CONSTRAINT "workspace_subscriptions_cycle_check" CHECK ("billing_cycle" IN ('monthly', 'yearly', 'custom')),
  CONSTRAINT "workspace_subscriptions_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "workspace_subscriptions_limits_check" CHECK ("seat_limit" > 0 AND "project_limit" > 0)
);
--> statement-breakpoint
ALTER TABLE "workspace_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workspace_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "workspace_subscriptions"
USING ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
WITH CHECK ("workspace_id" = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
DECLARE tenant record;
BEGIN
  FOR tenant IN SELECT workspace_id FROM tenant_provisioning_requests LOOP
    PERFORM set_config('app.current_workspace_id', tenant.workspace_id::text, true);
    INSERT INTO workspace_subscriptions
      (workspace_id, currency, renews_at)
    SELECT id, default_currency, now() + interval '14 days'
    FROM workspaces WHERE id = tenant.workspace_id
    ON CONFLICT (workspace_id) DO NOTHING;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON platform_administrators TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON workspace_subscriptions TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON "platform_administrators"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON "workspace_subscriptions"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
