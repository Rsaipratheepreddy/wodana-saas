-- Palm quotation review by Quantity Surveying is separate from owner approval.
INSERT INTO permissions (code, description)
VALUES ('commercial.estimate', 'Review and approve the cost estimate for a quotation before client issue')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE workspaces DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO roles (workspace_id, code, name, description, is_system)
SELECT workspace.id, 'quantity_surveyor', 'Quantity Surveyor',
       'Review quotation estimates before the client receives a proposal', false
FROM workspaces workspace
WHERE workspace.slug = 'plm'
ON CONFLICT (workspace_id, code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
FROM roles role
JOIN workspaces workspace ON workspace.id = role.workspace_id
JOIN permissions permission ON permission.code IN (
  'pre_projects.view', 'crm.opportunities.view',
  'commercial.costs.view', 'commercial.estimate'
)
WHERE workspace.slug = 'plm' AND role.code = 'quantity_surveyor'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
