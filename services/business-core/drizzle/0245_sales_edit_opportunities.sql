-- Sales edits an opportunity's details; the client's identity stays with Sales admins (Palm meeting, 2 Oct).
--   * crm.parties.identity: change a client's name or phone. Owners and administrators get it like every
--     permission; so does every role that runs CRM settings. A firm gives it to its Sales admins through their role.
--   * Whoever manages opportunities edits their value: roles holding crm.opportunities.manage without
--     crm.opportunities.sensitive_values (team roles copied before the rule) could not save an opportunity.
--   * Roles built from the Sales template get what editing an opportunity needs, if a tenant trimmed it.
-- Idempotent; nothing is removed.
INSERT INTO permissions (code, description) VALUES
  ('crm.parties.identity', 'Change a client''s name or phone')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE permission.code = 'crm.parties.identity'
   AND ((role.is_system AND role.code IN ('owner', 'administrator'))
     OR (NOT role.is_system AND EXISTS (
       SELECT 1 FROM role_permissions held JOIN permissions settings ON settings.id = held.permission_id
        WHERE held.role_id = role.id AND settings.code = 'crm.settings.manage')))
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system
   AND permission.code = 'crm.opportunities.sensitive_values'
   AND EXISTS (SELECT 1 FROM role_permissions held JOIN permissions manage ON manage.id = held.permission_id
                WHERE held.role_id = role.id AND manage.code = 'crm.opportunities.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system AND role.code = 'sales'
   AND permission.code IN ('crm.leads.view', 'crm.leads.manage', 'crm.parties.view', 'crm.parties.manage',
     'crm.opportunities.view', 'crm.opportunities.manage', 'crm.opportunities.transition', 'crm.opportunities.sensitive_values',
     'crm.activities.view', 'crm.activities.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
