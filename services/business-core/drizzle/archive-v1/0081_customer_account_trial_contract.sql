CREATE TABLE "customer_account_contracts" (
  "account_id" uuid PRIMARY KEY NOT NULL REFERENCES "customer_accounts"("id") ON DELETE cascade,
  "status" varchar(30) DEFAULT 'trial_uncontracted' NOT NULL,
  "plan_code" varchar(40) NOT NULL,
  "plan_version" integer NOT NULL,
  "currency" char(3) NOT NULL,
  "billing_cycle" varchar(20) NOT NULL,
  "seat_limit" integer NOT NULL,
  "project_limit" integer NOT NULL,
  "contract_reference" varchar(160),
  "signed_at" timestamp with time zone,
  "trial_ends_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_account_contracts_status_check" CHECK ("status" IN ('trial_uncontracted', 'contracted', 'expired')),
  CONSTRAINT "customer_account_contracts_cycle_check" CHECK ("billing_cycle" IN ('monthly', 'yearly', 'custom')),
  CONSTRAINT "customer_account_contracts_limits_check" CHECK ("seat_limit" > 0 AND "project_limit" > 0),
  CONSTRAINT "customer_account_contracts_version_check" CHECK ("version" > 0),
  CONSTRAINT "customer_account_contracts_signed_check" CHECK (("status" = 'contracted') = ("signed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "customer_account_contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_account_contracts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "linked_organization_access" ON "customer_account_contracts"
  USING (EXISTS (
    SELECT 1 FROM customer_account_organizations linked
    WHERE linked.account_id = customer_account_contracts.account_id
      AND linked.workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM customer_account_organizations linked
    WHERE linked.account_id = customer_account_contracts.account_id
      AND linked.workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid
  ));
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON customer_account_contracts TO wodana_app;
  END IF;
END $$;
