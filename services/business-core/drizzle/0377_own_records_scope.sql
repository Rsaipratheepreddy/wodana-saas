-- §0.3 P0 (guide C, PLM-038): "crm.leads.view_all" lets someone see every enquiry and opportunity; without it (and
-- without crm.leads.assign) a member sees their own: what they own or are tagged on. Every role that reads enquiries
-- today keeps seeing all of them, so nothing changes until a firm takes the permission off a seat (an account manager,
-- for example). Owners and administrators hold it like every permission. RLS untouched. Idempotent.
INSERT INTO permissions (code, description) VALUES
  ('crm.leads.view_all', 'See every enquiry and opportunity, not only your own')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT granted.workspace_id, granted.role_id, everything.id
  FROM role_permissions granted
  JOIN permissions viewing ON viewing.id = granted.permission_id AND viewing.code = 'crm.leads.view'
 CROSS JOIN permissions everything
 WHERE everything.code = 'crm.leads.view_all'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code = 'crm.leads.view_all'
ON CONFLICT (role_id, permission_id) DO NOTHING;
