-- Every workspace that uses the Palm quotation route needs an assignable QS role.
-- Preserve any role that a tenant has already defined with this code.
ALTER TABLE workspaces DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
WITH created AS (
  INSERT INTO roles (workspace_id, code, name, description, is_system)
  SELECT workspace.id, 'quantity_surveyor', 'Quantity Surveyor',
         'Review quotation estimates before the client receives a proposal', false
  FROM workspaces workspace
  ON CONFLICT (workspace_id, code) DO NOTHING
  RETURNING id, workspace_id
)
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT created.workspace_id, created.id, permission.id
FROM created
JOIN permissions permission ON permission.code IN (
  'pre_projects.view', 'crm.opportunities.view',
  'commercial.costs.view', 'commercial.estimate'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- The estimate permission was introduced after some Owner/Admin roles existed.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'commercial.estimate'
WHERE role.is_system = true AND role.code IN ('owner', 'administrator')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
