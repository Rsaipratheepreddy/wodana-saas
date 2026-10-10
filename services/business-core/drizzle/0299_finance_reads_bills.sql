-- Finance has Woddy read a supplier bill's photo (Ledger bill capture). Reading a bill is an AI suggestion, so it needs
-- ai.suggestions.use; a Finance role whose permissions were replaced by a firm's own list (after 0163 gave every staff
-- role Woddy) lost it, and Finance's photos were refused. The Finance role template now lists it; this gives it back to
-- the role built from that template (code 'finance') in every workspace. Keyed by the template's code, never by a
-- tenant; a firm's other roles are left as they are. Idempotent; nothing is removed.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system AND role.code = 'finance' AND permission.code = 'ai.suggestions.use'
ON CONFLICT (role_id, permission_id) DO NOTHING;
