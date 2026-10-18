-- Whoever enters supplier bills has Woddy read a bill's photo (Ledger bill capture). Reading a bill is an AI suggestion,
-- so it needs ai.suggestions.use; roles whose permissions were replaced by a firm's own list (after 0163 gave every staff
-- role Woddy) lost it, and their photos were refused. The Finance role template now lists it; this gives it back to the
-- role built from that template (code 'finance') and to every other role that manages payables (a firm's own Finance
-- or Accounts role), in every workspace. Keyed by the template's code and by what a role holds, never by a tenant; system
-- roles are left alone (owners and administrators already hold every permission). Idempotent; nothing is removed.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE permission.code = 'ai.suggestions.use'
   AND NOT role.is_system
   AND (role.code = 'finance'
     OR EXISTS (SELECT 1 FROM role_permissions held JOIN permissions payables ON payables.id = held.permission_id
                 WHERE held.role_id = role.id AND payables.code = 'payables.manage'))
ON CONFLICT (role_id, permission_id) DO NOTHING;
