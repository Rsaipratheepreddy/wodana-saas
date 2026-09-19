CREATE TABLE workspace_entitlement_sets (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE cascade,
  plan_code varchar(40) NOT NULL,
  plan_version integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_at timestamptz NOT NULL DEFAULT now(),
  reason varchar(500) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id) ON DELETE set null,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_entitlement_sets_status_check CHECK (status IN ('scheduled','active','suspended')),
  CONSTRAINT workspace_entitlement_sets_modules_check CHECK (jsonb_typeof(modules) = 'array'),
  CONSTRAINT workspace_entitlement_sets_limits_check CHECK (jsonb_typeof(limits) = 'object'),
  CONSTRAINT workspace_entitlement_sets_version_check CHECK (plan_version > 0 AND version > 0),
  CONSTRAINT workspace_entitlement_sets_reason_check CHECK (length(btrim(reason)) BETWEEN 3 AND 500)
);
--> statement-breakpoint
CREATE TABLE workspace_data_policies (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE cascade,
  storage_quota_bytes bigint NOT NULL,
  retention_days integer NOT NULL,
  legal_hold boolean NOT NULL DEFAULT false,
  scan_requirement varchar(20) NOT NULL DEFAULT 'required',
  scanner_status varchar(20) NOT NULL DEFAULT 'baseline',
  export_before_erasure boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id) ON DELETE set null,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_data_policies_quota_check CHECK (storage_quota_bytes BETWEEN 1048576 AND 10995116277760),
  CONSTRAINT workspace_data_policies_retention_check CHECK (retention_days BETWEEN 1 AND 3650),
  CONSTRAINT workspace_data_policies_scan_check CHECK (scan_requirement IN ('required','optional') AND scanner_status IN ('not_configured','baseline','healthy','degraded')),
  CONSTRAINT workspace_data_policies_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE TABLE tenant_support_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  approved_by uuid REFERENCES users(id) ON DELETE restrict,
  access_level varchar(24) NOT NULL DEFAULT 'read_only',
  status varchar(20) NOT NULL DEFAULT 'requested',
  reason varchar(500) NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  starts_at timestamptz,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  correlation_id uuid NOT NULL,
  CONSTRAINT tenant_support_sessions_access_check CHECK (access_level IN ('read_only','limited_write')),
  CONSTRAINT tenant_support_sessions_status_check CHECK (status IN ('requested','active','rejected','revoked','expired')),
  CONSTRAINT tenant_support_sessions_reason_check CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  CONSTRAINT tenant_support_sessions_time_check CHECK (expires_at > requested_at AND expires_at <= requested_at + interval '8 hours'),
  CONSTRAINT tenant_support_sessions_approval_check CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT tenant_support_sessions_version_check CHECK (version > 0)
);
CREATE INDEX tenant_support_sessions_state_idx ON tenant_support_sessions(workspace_id,status,expires_at DESC);
--> statement-breakpoint
CREATE TABLE tenant_operation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  target_workspace_id uuid REFERENCES workspaces(id) ON DELETE restrict,
  operation_type varchar(20) NOT NULL,
  phase varchar(20) NOT NULL DEFAULT 'dry_run',
  status varchar(20) NOT NULL DEFAULT 'planned',
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  reason varchar(500) NOT NULL,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  rollback_of uuid REFERENCES tenant_operation_runs(id) ON DELETE restrict,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  approved_by uuid REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT tenant_operation_runs_type_check CHECK (operation_type IN ('clone','export','erasure')),
  CONSTRAINT tenant_operation_runs_phase_check CHECK (phase IN ('dry_run','apply','rollback')),
  CONSTRAINT tenant_operation_runs_status_check CHECK (status IN ('planned','blocked','queued','running','succeeded','failed','cancelled')),
  CONSTRAINT tenant_operation_runs_reason_check CHECK (length(btrim(reason)) BETWEEN 10 AND 500),
  CONSTRAINT tenant_operation_runs_plan_check CHECK (jsonb_typeof(plan) = 'object' AND (result IS NULL OR jsonb_typeof(result) = 'object')),
  CONSTRAINT tenant_operation_runs_request_hash_check CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT tenant_operation_runs_target_check CHECK ((operation_type = 'clone' AND target_workspace_id IS NOT NULL AND target_workspace_id <> workspace_id) OR operation_type <> 'clone'),
  CONSTRAINT tenant_operation_runs_approval_check CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT tenant_operation_runs_idempotency_unique UNIQUE (workspace_id,idempotency_key)
);
CREATE INDEX tenant_operation_runs_history_idx ON tenant_operation_runs(workspace_id,created_at DESC,id DESC);
--> statement-breakpoint
DO $$ DECLARE relation_name text; BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'workspace_entitlement_sets',
    'workspace_data_policies',
    'tenant_support_sessions',
    'tenant_operation_runs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting(''app.current_workspace_id'',true),'''')::uuid)',
      relation_name
    );
  END LOOP;
END $$;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspace_entitlement_sets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON workspace_data_policies
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE ON workspace_entitlement_sets TO wodana_app;
    GRANT SELECT,INSERT,UPDATE ON workspace_data_policies TO wodana_app;
    GRANT SELECT,INSERT,UPDATE ON tenant_support_sessions TO wodana_app;
    GRANT SELECT,INSERT,UPDATE ON tenant_operation_runs TO wodana_app;
  END IF;
END $$;
