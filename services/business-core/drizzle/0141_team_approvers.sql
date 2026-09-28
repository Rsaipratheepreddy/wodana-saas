-- The named team can act, not only the Owner.
--
-- 1. Sales sends its own quotes: `portal.contacts.manage` lets someone name a case's client contacts and
--    decision-makers without managing the whole client portal. Owners and administrators get it like every
--    permission; the kit's Sales role gets it too.
-- 2. Firm kits offer the people who approve and pay: Finance, Finance approver, Buyer, Purchasing approver,
--    Factory lead, QC inspector and Storekeeper (names and permissions live in workspaces/role-templates.ts;
--    role-templates.spec.ts keeps this file in step). A design studio's kit offers only the finance roles.
-- 3. Existing workspaces get the same roles, unassigned, so an owner can hand approvals to the team today.
--    A workspace that already has a role with the code keeps its own.
-- 4. One role vocabulary: a source limited to roles (e.g. Self Generated) stores lower-case codes, compared
--    case-insensitively against a member's roles and teams.
-- 5. Hand-off notices: the QS approved a quote, a client receipt was reported, a receipt was verified, and
--    the client's "payment received" email.
-- Idempotent throughout.
INSERT INTO permissions (code, description) VALUES
  ('portal.contacts.manage', 'Add and change a case''s client contacts and decision-makers')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code = 'portal.contacts.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system AND role.code = 'sales' AND permission.code = 'portal.contacts.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
UPDATE tenant_setup_profiles
   SET configuration = jsonb_set(configuration, '{roleTemplates}',
         configuration->'roleTemplates' || (
           SELECT coalesce(jsonb_agg(code), '[]'::jsonb) FROM unnest(ARRAY['finance','finance_approver']) AS code
            WHERE NOT (configuration->'roleTemplates') ? code))
 WHERE kind = 'firm_kit' AND code = 'interior_studio' AND jsonb_typeof(configuration->'roleTemplates') = 'array';
--> statement-breakpoint
UPDATE tenant_setup_profiles
   SET configuration = jsonb_set(configuration, '{roleTemplates}',
         configuration->'roleTemplates' || (
           SELECT coalesce(jsonb_agg(code), '[]'::jsonb)
             FROM unnest(ARRAY['finance','finance_approver','buyer','purchasing_approver','factory_lead','qc_inspector','storekeeper']) AS code
            WHERE NOT (configuration->'roleTemplates') ? code))
 WHERE kind = 'firm_kit' AND code <> 'interior_studio' AND jsonb_typeof(configuration->'roleTemplates') = 'array';
--> statement-breakpoint
CREATE TEMPORARY TABLE team_role_templates (code text, name text, description text, permissions text[], studio boolean);
--> statement-breakpoint
INSERT INTO team_role_templates VALUES
  ('finance', 'Finance', 'Enters supplier bills and client invoices, records payments and petty cash, and verifies client receipts and deals',
    ARRAY['pre_projects.view','crm.opportunities.view','projects.view','commercial.costs.view','commercial.finance.verify','payables.view','payables.manage','receivables.view','receivables.manage','accounting.manage'], true),
  ('finance_approver', 'Finance approver', 'Approves held supplier bills and payment runs that someone else prepared',
    ARRAY['projects.view','payables.view','payables.approve','receivables.view'], true),
  ('buyer', 'Buyer', 'Raises purchase orders, chases suppliers and receives what arrives; someone else approves the orders',
    ARRAY['projects.view','projects.buy','catalog.view','purchasing.view','purchasing.manage','vendors.view','vendors.manage','supplier_offers.view','supplier_offers.manage','stock.view','stock.receive'], false),
  ('purchasing_approver', 'Purchasing approver', 'Approves purchase orders, new suppliers, stock corrections and orders beyond a project''s money in hand',
    ARRAY['projects.view','purchasing.view','purchasing.approve','vendors.view','vendors.approve','stock.view','stock.adjust','projects.funds_override'], false),
  ('factory_lead', 'Factory lead', 'Plans and releases factory work, reports output and approves what the team made',
    ARRAY['projects.view','projects.schedule.view','catalog.view','stock.view','factory.view','factory.manage','factory.report','factory.approve'], false),
  ('qc_inspector', 'QC inspector', 'Checks factory output and incoming goods before they are accepted',
    ARRAY['projects.view','factory.view','factory.approve','stock.view','stock.inspect'], false),
  ('storekeeper', 'Storekeeper', 'Receives, moves and counts stock; corrections go to an approver',
    ARRAY['projects.view','catalog.view','purchasing.view','stock.view','stock.manage','stock.receive','stock.inspect'], false);
--> statement-breakpoint
INSERT INTO roles (workspace_id, code, name, description, is_system)
SELECT workspace.id, template.code, template.name, template.description, false
  FROM workspaces workspace CROSS JOIN team_role_templates template
 WHERE (template.studio OR NOT EXISTS (
          SELECT 1 FROM workspace_setup_versions setup
           WHERE setup.workspace_id = workspace.id AND setup.firm_kit_code = 'interior_studio'
             AND setup.created_at = (SELECT max(latest.created_at) FROM workspace_setup_versions latest WHERE latest.workspace_id = workspace.id)))
   AND NOT EXISTS (SELECT 1 FROM roles existing WHERE existing.workspace_id = workspace.id AND lower(existing.code) = template.code);
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role
  JOIN team_role_templates template ON template.code = role.code
  JOIN permissions permission ON permission.code = ANY(template.permissions)
 WHERE NOT role.is_system
   AND NOT EXISTS (SELECT 1 FROM role_permissions granted WHERE granted.role_id = role.id)
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
DROP TABLE team_role_templates;
--> statement-breakpoint
UPDATE crm_taxonomy_options
   SET allowed_role_codes = (SELECT array_agg(DISTINCT lower(code) ORDER BY lower(code)) FROM unnest(allowed_role_codes) AS code),
       version = version + 1
 WHERE allowed_role_codes IS NOT NULL
   AND EXISTS (SELECT 1 FROM unnest(allowed_role_codes) AS code WHERE code <> lower(code));
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('quotation.qs_approved', 'in_app', '{{title}} is ready to send', '{{actor}} approved the estimate for {{clientName}}.', '["title", "clientName", "actor", "note"]'),
  ('quotation.qs_approved', 'email', '{{title}} is ready to send · {{clientName}}', E'{{actor}} approved the estimate for {{title}} ({{clientName}}).\n\nOpen the quote to send it to the client.', '["title", "clientName", "actor", "note"]'),
  ('commercial.receipt_reported', 'in_app', 'Payment to verify · {{clientName}}', '{{actor}} reported {{amount}} for {{title}}.', '["title", "clientName", "actor", "amount", "note"]'),
  ('commercial.receipt_reported', 'email', 'Payment to verify · {{clientName}}', E'{{actor}} reported {{amount}} for {{title}} ({{clientName}}).\n\nOpen it to check the receipt and verify it.', '["title", "clientName", "actor", "amount", "note"]'),
  ('commercial.receipt_verified', 'in_app', 'Payment verified · {{clientName}}', '{{actor}} verified {{amount}} for {{title}}.', '["title", "clientName", "actor", "amount", "note"]'),
  ('portal.payment_received', 'email', 'Payment received: {{title}}', E'{{company}} received your payment for {{title}} on {{project}}.\n\nOpen your project page to see what comes next.', '["company", "project", "title", "due", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
