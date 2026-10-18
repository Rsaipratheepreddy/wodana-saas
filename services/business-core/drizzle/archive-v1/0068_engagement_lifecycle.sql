ALTER TABLE pre_project_cases DROP CONSTRAINT pre_project_cases_status_check;

ALTER TABLE pre_project_cases
  ADD COLUMN phase varchar(20) NOT NULL DEFAULT 'discover',
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN owner_membership_id uuid,
  ADD COLUMN target_date date,
  ADD COLUMN priority varchar(16) NOT NULL DEFAULT 'normal',
  ADD COLUMN risk_level varchar(16) NOT NULL DEFAULT 'none',
  ADD COLUMN activated_at timestamptz,
  ADD COLUMN hold_reason varchar(500),
  ADD COLUMN held_at timestamptz,
  ADD COLUMN held_by uuid REFERENCES users(id),
  ADD COLUMN cancellation_reason varchar(500),
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by uuid REFERENCES users(id),
  ADD COLUMN released_at timestamptz,
  ADD COLUMN released_by uuid REFERENCES users(id);

UPDATE pre_project_cases engagement
SET owner_membership_id = COALESCE(
      (SELECT owner_membership.id
         FROM crm_opportunities opportunity
         JOIN workspace_memberships owner_membership
           ON owner_membership.workspace_id = opportunity.workspace_id
          AND owner_membership.id = opportunity.owner_membership_id
          AND owner_membership.status = 'active'
         JOIN users owner_account ON owner_account.id = owner_membership.user_id AND owner_account.status = 'active'
        WHERE opportunity.workspace_id = engagement.workspace_id
          AND opportunity.id = engagement.opportunity_id),
      (SELECT membership.id
         FROM workspace_memberships membership
         JOIN users creator_account ON creator_account.id = membership.user_id AND creator_account.status = 'active'
        WHERE membership.workspace_id = engagement.workspace_id
          AND membership.user_id = engagement.created_by
          AND membership.status = 'active'
        ORDER BY membership.created_at
        LIMIT 1)
    ),
    activated_at = CASE WHEN engagement.status IN ('active', 'released') THEN engagement.created_at ELSE NULL END,
    phase = CASE WHEN engagement.status = 'released' THEN 'release' ELSE 'discover' END,
    released_at = CASE WHEN engagement.status = 'released' THEN engagement.updated_at ELSE NULL END,
    cancellation_reason = CASE WHEN engagement.status = 'archived' THEN 'Migrated from the legacy archived state.' ELSE NULL END,
    cancelled_at = CASE WHEN engagement.status = 'archived' THEN engagement.updated_at ELSE NULL END,
    status = CASE WHEN engagement.status = 'archived' THEN 'cancelled' ELSE engagement.status END;

ALTER TABLE pre_project_cases
  ADD CONSTRAINT pre_project_cases_owner_membership_fk
    FOREIGN KEY(workspace_id, owner_membership_id)
    REFERENCES workspace_memberships(workspace_id, id),
  ADD CONSTRAINT pre_project_cases_status_check
    CHECK(status IN ('draft', 'active', 'on_hold', 'released', 'cancelled')),
  ADD CONSTRAINT pre_project_cases_phase_check
    CHECK(phase IN ('discover', 'define', 'design', 'price', 'agree', 'release')),
  ADD CONSTRAINT pre_project_cases_version_check CHECK(version > 0),
  ADD CONSTRAINT pre_project_cases_priority_check
    CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
  ADD CONSTRAINT pre_project_cases_risk_check
    CHECK(risk_level IN ('none', 'low', 'medium', 'high', 'critical')),
  ADD CONSTRAINT pre_project_cases_hold_state_check CHECK(
    (status = 'on_hold' AND held_at IS NOT NULL AND held_by IS NOT NULL AND hold_reason IS NOT NULL AND length(trim(hold_reason)) > 0)
    OR
    (status <> 'on_hold' AND held_at IS NULL AND held_by IS NULL AND hold_reason IS NULL)
  ),
  ADD CONSTRAINT pre_project_cases_cancel_state_check CHECK(
    (status = 'cancelled' AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL AND length(trim(cancellation_reason)) > 0)
    OR
    (status <> 'cancelled' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL)
  ),
  ADD CONSTRAINT pre_project_cases_release_state_check CHECK(
    (status = 'released' AND phase = 'release' AND released_at IS NOT NULL)
    OR
    (status <> 'released' AND released_at IS NULL AND released_by IS NULL)
  );

CREATE INDEX pre_project_cases_owner_status_idx
  ON pre_project_cases(workspace_id, owner_membership_id, status, updated_at DESC);
CREATE INDEX pre_project_cases_target_date_idx
  ON pre_project_cases(workspace_id, status, target_date)
  WHERE target_date IS NOT NULL;

CREATE TABLE pre_project_lifecycle_commands (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  case_id uuid NOT NULL,
  action varchar(40) NOT NULL,
  request_hash char(64) NOT NULL,
  response_body jsonb,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id, request_id),
  FOREIGN KEY(workspace_id, case_id) REFERENCES pre_project_cases(workspace_id, id) ON DELETE CASCADE,
  CHECK(length(trim(action)) > 0),
  CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  CHECK(response_body IS NULL OR jsonb_typeof(response_body) = 'object')
);
CREATE INDEX pre_project_lifecycle_commands_case_idx
  ON pre_project_lifecycle_commands(workspace_id, case_id, created_at DESC);
ALTER TABLE pre_project_lifecycle_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_project_lifecycle_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pre_project_lifecycle_commands
USING(workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
WITH CHECK(workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

INSERT INTO permissions(code, description) VALUES
  ('pre_projects.manage_lifecycle', 'Manage pre-execution ownership, priority, risk, phase, hold and cancellation lifecycle')
ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system = true
  AND role.code IN ('owner', 'administrator')
  AND permission.code = 'pre_projects.manage_lifecycle'
ON CONFLICT(role_id, permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON pre_project_lifecycle_commands TO wodana_app;
  END IF;
END $$;
