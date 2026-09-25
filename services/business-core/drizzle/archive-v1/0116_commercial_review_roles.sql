-- Reusable, editable workspace roles for the two independent commercial checks.
-- Existing roles with these codes are deliberately left untouched.
INSERT INTO permissions (code, description)
VALUES ('commercial.deal.approve', 'Approve a Finance-verified Deal File without quotation approval access')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE workspaces DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
WITH role_definitions(code, name, description) AS (
  VALUES
    ('finance_reviewer', 'Finance reviewer', 'Verify deal payment evidence and confirm final commissions before operations approval'),
    ('operations_approver', 'Operations approver', 'Approve Finance-verified deals and authorize their release to production')
), created AS (
  INSERT INTO roles (workspace_id, code, name, description, is_system)
  SELECT workspace.id, role_definitions.code, role_definitions.name, role_definitions.description, false
  FROM workspaces workspace CROSS JOIN role_definitions
  ON CONFLICT (workspace_id, code) DO NOTHING
  RETURNING id, workspace_id, code
), grants(role_code, permission_code) AS (
  VALUES
    ('finance_reviewer', 'pre_projects.view'),
    ('finance_reviewer', 'crm.opportunities.view'),
    ('finance_reviewer', 'commercial.finance.verify'),
    ('operations_approver', 'pre_projects.view'),
    ('operations_approver', 'crm.opportunities.view'),
    ('operations_approver', 'commercial.deal.approve'),
    ('operations_approver', 'commercial.release')
)
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT created.workspace_id, created.id, permission.id
FROM created
JOIN grants ON grants.role_code = created.code
JOIN permissions permission ON permission.code = grants.permission_code
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
FROM roles role JOIN permissions permission ON permission.code = 'commercial.deal.approve'
WHERE role.is_system = true AND role.code IN ('owner', 'administrator')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
