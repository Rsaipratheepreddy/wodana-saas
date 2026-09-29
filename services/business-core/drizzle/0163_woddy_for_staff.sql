-- Every staff role can ask Woddy (the workspace AI switch and AI credits still decide whether it answers).
-- Only viewers stay without it. New workspaces get the same from workspace creation. Idempotent.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.workspace_id IS NOT NULL
   AND role.code <> 'viewer'
   AND permission.code = 'ai.suggestions.use'
ON CONFLICT (role_id, permission_id) DO NOTHING;
