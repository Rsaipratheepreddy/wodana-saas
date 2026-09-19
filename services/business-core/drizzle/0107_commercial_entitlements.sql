CREATE TABLE account_entitlement_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE cascade,
  version integer NOT NULL,
  plan_kind varchar(20) NOT NULL DEFAULT 'plan',
  plan_code varchar(40) NOT NULL,
  plan_version integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  sold_modules jsonb NOT NULL DEFAULT '["workspace"]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  custom_override boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  reason varchar(500) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_entitlement_versions_account_version_uidx UNIQUE(account_id,version),
  CONSTRAINT account_entitlement_versions_plan_fk FOREIGN KEY(plan_kind,plan_code,plan_version)
    REFERENCES tenant_setup_profiles(kind,code,version) ON DELETE restrict,
  CONSTRAINT account_entitlement_versions_plan_kind_check CHECK(plan_kind='plan'),
  CONSTRAINT account_entitlement_versions_status_check CHECK(status IN ('active','suspended','expired')),
  CONSTRAINT account_entitlement_versions_modules_check CHECK(jsonb_typeof(sold_modules)='array' AND sold_modules ? 'workspace'),
  CONSTRAINT account_entitlement_versions_limits_check CHECK(jsonb_typeof(limits)='object'),
  CONSTRAINT account_entitlement_versions_version_check CHECK(version>0 AND plan_version>0),
  CONSTRAINT account_entitlement_versions_time_check CHECK(effective_until IS NULL OR effective_until>effective_from),
  CONSTRAINT account_entitlement_versions_reason_check CHECK(length(btrim(reason)) BETWEEN 10 AND 500)
);
CREATE INDEX account_entitlement_versions_effective_idx
  ON account_entitlement_versions(account_id,effective_from DESC,version DESC);
--> statement-breakpoint
CREATE TABLE organization_entitlement_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  account_entitlement_id uuid NOT NULL REFERENCES account_entitlement_versions(id) ON DELETE restrict,
  version integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  modules jsonb NOT NULL DEFAULT '["workspace"]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  reason varchar(500) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_entitlement_allocations_workspace_version_uidx UNIQUE(workspace_id,version),
  CONSTRAINT organization_entitlement_allocations_status_check CHECK(status IN ('scheduled','active','suspended','expired')),
  CONSTRAINT organization_entitlement_allocations_modules_check CHECK(jsonb_typeof(modules)='array' AND modules ? 'workspace'),
  CONSTRAINT organization_entitlement_allocations_limits_check CHECK(jsonb_typeof(limits)='object'),
  CONSTRAINT organization_entitlement_allocations_version_check CHECK(version>0),
  CONSTRAINT organization_entitlement_allocations_time_check CHECK(effective_until IS NULL OR effective_until>effective_from),
  CONSTRAINT organization_entitlement_allocations_reason_check CHECK(length(btrim(reason)) BETWEEN 10 AND 500)
);
CREATE INDEX organization_entitlement_allocations_effective_idx
  ON organization_entitlement_allocations(workspace_id,effective_from DESC,version DESC);
--> statement-breakpoint
CREATE TABLE platform_capability_flags (
  code varchar(120) PRIMARY KEY,
  module varchar(20) NOT NULL,
  release_state varchar(24) NOT NULL DEFAULT 'unavailable',
  reason varchar(500) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_capability_flags_module_check CHECK(module IN ('workspace','crm','pre-project','projects','hrms')),
  CONSTRAINT platform_capability_flags_state_check CHECK(release_state IN ('unavailable','internal_preview','available')),
  CONSTRAINT platform_capability_flags_code_check CHECK(code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  CONSTRAINT platform_capability_flags_reason_check CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
  CONSTRAINT platform_capability_flags_version_check CHECK(version>0)
);
CREATE TRIGGER platform_capability_flags_set_updated_at BEFORE UPDATE ON platform_capability_flags
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
ALTER TABLE workspace_entitlement_sets ADD COLUMN effective_until timestamptz;
ALTER TABLE workspace_entitlement_sets ADD CONSTRAINT workspace_entitlement_sets_time_check
  CHECK(effective_until IS NULL OR effective_until>effective_at);
--> statement-breakpoint
ALTER TABLE account_entitlement_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_entitlement_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY linked_organization_access ON account_entitlement_versions
  USING(EXISTS(
    SELECT 1 FROM customer_account_organizations linked
    WHERE linked.account_id=account_entitlement_versions.account_id
      AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
  ))
  WITH CHECK(EXISTS(
    SELECT 1 FROM customer_account_organizations linked
    WHERE linked.account_id=account_entitlement_versions.account_id
      AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
  ));
ALTER TABLE organization_entitlement_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_entitlement_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_entitlement_allocations
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
--> statement-breakpoint
CREATE VIEW effective_workspace_entitlements WITH (security_invoker=true) AS
WITH candidate AS (
  SELECT allocation.workspace_id,account.plan_code,account.plan_version,
    CASE
      WHEN now()<GREATEST(account.effective_from,allocation.effective_from) THEN 'scheduled'
      WHEN account.status<>'active' THEN account.status
      WHEN allocation.status<>'active' THEN allocation.status
      WHEN LEAST(account.effective_until,allocation.effective_until) IS NOT NULL
        AND now()>=LEAST(account.effective_until,allocation.effective_until) THEN 'expired'
      ELSE 'active'
    END AS status,
    allocation.modules,(account.limits || allocation.limits) AS limits,
    account.sold_modules,account.limits AS sold_limits,account.custom_override,
    GREATEST(account.effective_from,allocation.effective_from) AS effective_at,
    LEAST(account.effective_until,allocation.effective_until) AS effective_until,
    allocation.reason,allocation.version,allocation.created_at AS updated_at,'allocation'::text AS source,
    row_number() OVER(
      PARTITION BY allocation.workspace_id
      ORDER BY
        CASE
          WHEN now()>=GREATEST(account.effective_from,allocation.effective_from)
            AND (LEAST(account.effective_until,allocation.effective_until) IS NULL
              OR now()<LEAST(account.effective_until,allocation.effective_until)) THEN 0
          WHEN now()<GREATEST(account.effective_from,allocation.effective_from) THEN 1
          ELSE 2
        END,
        CASE WHEN now()<GREATEST(account.effective_from,allocation.effective_from)
          THEN GREATEST(account.effective_from,allocation.effective_from) END ASC,
        CASE WHEN now()>=GREATEST(account.effective_from,allocation.effective_from)
          THEN GREATEST(account.effective_from,allocation.effective_from) END DESC,
        allocation.version DESC
    ) AS rank
  FROM organization_entitlement_allocations allocation
  JOIN account_entitlement_versions account ON account.id=allocation.account_entitlement_id
), chosen AS (
  SELECT workspace_id,plan_code,plan_version,status,modules,limits,sold_modules,sold_limits,custom_override,
    effective_at,effective_until,reason,version,updated_at,source FROM candidate WHERE rank=1
), legacy AS (
  SELECT legacy.workspace_id,legacy.plan_code,legacy.plan_version,legacy.status,legacy.modules,legacy.limits,
    legacy.modules AS sold_modules,legacy.limits AS sold_limits,true AS custom_override,
    legacy.effective_at,legacy.effective_until,legacy.reason,legacy.version,legacy.updated_at,
    'legacy'::text AS source
  FROM workspace_entitlement_sets legacy
  WHERE NOT EXISTS(
    SELECT 1 FROM organization_entitlement_allocations allocation WHERE allocation.workspace_id=legacy.workspace_id
  )
)
SELECT * FROM chosen
UNION ALL
SELECT * FROM legacy;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT ON account_entitlement_versions TO wodana_app;
    GRANT SELECT,INSERT ON organization_entitlement_allocations TO wodana_app;
    GRANT SELECT,INSERT,UPDATE ON platform_capability_flags TO wodana_app;
    GRANT SELECT ON effective_workspace_entitlements TO wodana_app;
  END IF;
END $$;
