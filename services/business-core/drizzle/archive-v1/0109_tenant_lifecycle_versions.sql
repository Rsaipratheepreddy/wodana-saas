CREATE TABLE tenant_lifecycle_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE restrict,
  version integer NOT NULL,
  state varchar(20) NOT NULL,
  previous_state varchar(20) NOT NULL,
  grace_ends_at timestamptz,
  reason varchar(500) NOT NULL,
  notice_required boolean NOT NULL,
  notice_delivery_state varchar(24) NOT NULL DEFAULT 'not_configured',
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  correlation_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_lifecycle_workspace_version_unique UNIQUE(workspace_id,version),
  CONSTRAINT tenant_lifecycle_workspace_key_unique UNIQUE(workspace_id,idempotency_key),
  CONSTRAINT tenant_lifecycle_state_check CHECK(state IN ('draft','trial','active','grace','suspended','archived')),
  CONSTRAINT tenant_lifecycle_previous_state_check CHECK(previous_state IN ('draft','trial','active','grace','suspended','archived')),
  CONSTRAINT tenant_lifecycle_distinct_state_check CHECK(state<>previous_state),
  CONSTRAINT tenant_lifecycle_grace_check CHECK((state='grace')=(grace_ends_at IS NOT NULL)),
  CONSTRAINT tenant_lifecycle_reason_check CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
  CONSTRAINT tenant_lifecycle_notice_check CHECK(notice_delivery_state IN ('not_required','not_configured')),
  CONSTRAINT tenant_lifecycle_hash_check CHECK(request_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX tenant_lifecycle_history_idx ON tenant_lifecycle_versions(workspace_id,version DESC);
--> statement-breakpoint
CREATE FUNCTION prevent_tenant_lifecycle_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'tenant_lifecycle_versions is append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER tenant_lifecycle_append_only BEFORE UPDATE OR DELETE ON tenant_lifecycle_versions
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_lifecycle_mutation();
--> statement-breakpoint
ALTER TABLE tenant_lifecycle_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_lifecycle_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_lifecycle_read ON tenant_lifecycle_versions FOR SELECT
USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
CREATE POLICY tenant_lifecycle_operator_insert ON tenant_lifecycle_versions FOR INSERT
WITH CHECK(
  workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
  AND created_by=NULLIF(current_setting('app.current_actor_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id=created_by AND operator.status='active'
      AND operator.role IN ('administrator','platform_security_owner'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT ON tenant_lifecycle_versions TO wodana_app;
  END IF;
END $$;
