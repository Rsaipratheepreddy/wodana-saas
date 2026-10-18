-- The seeded "Finance reviewer" role reads Finance (supplier bills and client invoices), so the person who
-- verifies payments can see what came in and what is owed. New workspaces get it from the role template;
-- this grants it to the role already created in every existing workspace. Tenant-edited roles only gain
-- these two read permissions; nothing is removed.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.code = 'finance_reviewer' AND permission.code IN ('payables.view', 'receivables.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;
