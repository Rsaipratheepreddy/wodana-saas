CREATE TABLE "customer_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_customer_id" varchar(160),
  "display_name" varchar(160) NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "organization_limit" integer DEFAULT 1 NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_accounts_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "customer_accounts_status_check" CHECK ("status" IN ('active', 'suspended', 'archived')),
  CONSTRAINT "customer_accounts_organization_limit_check" CHECK ("organization_limit" > 0),
  CONSTRAINT "customer_accounts_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_accounts_external_customer_uidx"
  ON "customer_accounts" ("external_customer_id")
  WHERE "external_customer_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE "customer_account_memberships" (
  "account_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" varchar(30) DEFAULT 'member' NOT NULL,
  "status" varchar(20) DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_account_memberships_pk" PRIMARY KEY ("account_id", "user_id"),
  CONSTRAINT "customer_account_memberships_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade,
  CONSTRAINT "customer_account_memberships_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
  CONSTRAINT "customer_account_memberships_role_check" CHECK ("role" IN ('owner', 'administrator', 'member')),
  CONSTRAINT "customer_account_memberships_status_check" CHECK ("status" IN ('active', 'suspended'))
);
--> statement-breakpoint
CREATE INDEX "customer_account_memberships_user_idx"
  ON "customer_account_memberships" ("user_id", "status");
--> statement-breakpoint
CREATE TABLE "customer_account_organizations" (
  "account_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "customer_account_organizations_pk" PRIMARY KEY ("account_id", "workspace_id"),
  CONSTRAINT "customer_account_organizations_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade,
  CONSTRAINT "customer_account_organizations_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_account_organizations_workspace_uidx"
  ON "customer_account_organizations" ("workspace_id");
CREATE UNIQUE INDEX "customer_account_default_organization_uidx"
  ON "customer_account_organizations" ("account_id")
  WHERE "is_default" = true;
--> statement-breakpoint
CREATE TABLE "organization_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "account_id" uuid NOT NULL,
  "source_workspace_id" uuid NOT NULL,
  "requested_by" uuid NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "request_hash" char(64) NOT NULL,
  "name" varchar(160) NOT NULL,
  "slug" varchar(80) NOT NULL,
  "configuration" jsonb NOT NULL,
  "reason" varchar(500),
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "decision_reason" varchar(500),
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "approved_workspace_id" uuid,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "organization_requests_account_id_fk"
    FOREIGN KEY ("account_id") REFERENCES "public"."customer_accounts"("id") ON DELETE cascade,
  CONSTRAINT "organization_requests_source_workspace_id_fk"
    FOREIGN KEY ("source_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict,
  CONSTRAINT "organization_requests_requested_by_fk"
    FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict,
  CONSTRAINT "organization_requests_reviewed_by_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null,
  CONSTRAINT "organization_requests_approved_workspace_id_fk"
    FOREIGN KEY ("approved_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict,
  CONSTRAINT "organization_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT "organization_requests_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT "organization_requests_configuration_check" CHECK (jsonb_typeof("configuration") = 'object'),
  CONSTRAINT "organization_requests_version_check" CHECK ("version" > 0),
  CONSTRAINT "organization_requests_decision_check" CHECK (
    ("status" = 'pending' AND "reviewed_at" IS NULL AND "approved_workspace_id" IS NULL)
    OR ("status" = 'cancelled' AND "approved_workspace_id" IS NULL)
    OR ("status" = 'rejected' AND "reviewed_at" IS NOT NULL AND "approved_workspace_id" IS NULL)
    OR ("status" = 'approved' AND "reviewed_at" IS NOT NULL AND "approved_workspace_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_requests_account_idempotency_uidx"
  ON "organization_requests" ("account_id", "idempotency_key");
CREATE UNIQUE INDEX "organization_requests_pending_slug_uidx"
  ON "organization_requests" ("account_id", lower("slug"))
  WHERE "status" = 'pending';
CREATE UNIQUE INDEX "organization_requests_approved_workspace_uidx"
  ON "organization_requests" ("approved_workspace_id")
  WHERE "approved_workspace_id" IS NOT NULL;
CREATE INDEX "organization_requests_review_queue_idx"
  ON "organization_requests" ("status", "created_at");
--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_customer_account_organization_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approved_limit integer;
  current_count integer;
BEGIN
  SELECT organization_limit INTO approved_limit
  FROM customer_accounts
  WHERE id = NEW.account_id
  FOR UPDATE;

  SELECT count(*)::integer INTO current_count
  FROM customer_account_organizations
  WHERE account_id = NEW.account_id;

  IF approved_limit IS NULL OR current_count >= approved_limit THEN
    RAISE EXCEPTION 'Customer account organization limit reached'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "customer_account_organization_limit_guard"
BEFORE INSERT ON "customer_account_organizations"
FOR EACH ROW EXECUTE FUNCTION enforce_customer_account_organization_limit();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION enforce_organization_request_account_links()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM customer_account_organizations linked
    WHERE linked.account_id = NEW.account_id
      AND linked.workspace_id = NEW.source_workspace_id
  ) THEN
    RAISE EXCEPTION 'Organization request source does not belong to customer account'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.approved_workspace_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM customer_account_organizations linked
    WHERE linked.account_id = NEW.account_id
      AND linked.workspace_id = NEW.approved_workspace_id
  ) THEN
    RAISE EXCEPTION 'Approved organization does not belong to customer account'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "organization_request_account_link_guard"
BEFORE INSERT OR UPDATE ON "organization_requests"
FOR EACH ROW EXECUTE FUNCTION enforce_organization_request_account_links();
--> statement-breakpoint

-- A workspace member belongs to the customer account for discovery purposes, but receives
-- access only to organizations where they also hold an active workspace membership.
CREATE OR REPLACE FUNCTION ensure_customer_account_membership_for_workspace_member()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    INSERT INTO customer_account_memberships (account_id, user_id, role, status)
    SELECT linked.account_id, NEW.user_id, 'member', 'active'
    FROM customer_account_organizations linked
    WHERE linked.workspace_id = NEW.workspace_id
    ON CONFLICT (account_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "workspace_member_customer_account_membership"
AFTER INSERT OR UPDATE OF status, user_id, workspace_id ON "workspace_memberships"
FOR EACH ROW EXECUTE FUNCTION ensure_customer_account_membership_for_workspace_member();
--> statement-breakpoint

-- Every existing workspace becomes the default organization of its own customer account.
-- No tenant data is moved or combined by this backfill.
ALTER TABLE "workspaces" NO FORCE ROW LEVEL SECURITY;
DO $$
DECLARE
  workspace_record record;
  account_id uuid;
BEGIN
  FOR workspace_record IN
    SELECT workspace.id, workspace.name, workspace.created_by,
           provisioning.external_tenant_id
    FROM workspaces workspace
    LEFT JOIN tenant_provisioning_requests provisioning
      ON provisioning.workspace_id = workspace.id
    WHERE NOT EXISTS (
      SELECT 1 FROM customer_account_organizations existing
      WHERE existing.workspace_id = workspace.id
    )
  LOOP
    account_id := gen_random_uuid();
    INSERT INTO customer_accounts
      (id, external_customer_id, display_name, created_by)
    VALUES
      (account_id, workspace_record.external_tenant_id, workspace_record.name, workspace_record.created_by);
    INSERT INTO customer_account_memberships
      (account_id, user_id, role, status)
    VALUES
      (account_id, workspace_record.created_by, 'owner', 'active');
    INSERT INTO customer_account_organizations
      (account_id, workspace_id, is_default)
    VALUES
      (account_id, workspace_record.id, true);
  END LOOP;
END $$;

-- Preserve every existing active user's ability to discover their own organization. Account
-- membership alone never grants access to another organization's business data.
INSERT INTO customer_account_memberships (account_id, user_id, role, status)
SELECT DISTINCT linked.account_id, membership.user_id, 'member', 'active'
FROM customer_account_organizations linked
JOIN workspace_memberships membership ON membership.workspace_id = linked.workspace_id
WHERE membership.status = 'active'
ON CONFLICT (account_id, user_id) DO NOTHING;

ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON "customer_accounts"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON "customer_account_memberships"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON "organization_requests"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON customer_accounts TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON customer_account_memberships TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON customer_account_organizations TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON organization_requests TO wodana_app;
  END IF;
END $$;
