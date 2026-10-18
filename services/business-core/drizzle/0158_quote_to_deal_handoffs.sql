-- Quote to deal without dead ends, on top of the team templates from 0152.
--
-- 1. Sales sends its own quotes: `portal.contacts.manage` names a case's client contacts and decision-makers
--    without managing the whole client portal. Owners and administrators get it like every permission;
--    the kit's Sales role gets it too (role-templates.ts).
-- 2. One role vocabulary: a source limited to roles (e.g. Self Generated) stores lower-case codes, compared
--    case-insensitively against a member's roles and teams.
-- 3. Hand-off notices: the estimate is approved (the quote is ready to send), a client receipt was reported
--    (Finance verifies it), and it was verified (the reporter, the account manager and waiting deal approvers).
-- Idempotent throughout.
INSERT INTO permissions (code, description) VALUES
  ('portal.contacts.manage', 'Add and change a case''s client contacts and decision-makers')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE ((role.is_system AND role.code IN ('owner', 'administrator')) OR (NOT role.is_system AND role.code = 'sales'))
   AND permission.code = 'portal.contacts.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
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
  ('commercial.receipt_verified', 'in_app', 'Payment verified · {{clientName}}', '{{actor}} verified {{amount}} for {{title}}.', '["title", "clientName", "actor", "amount", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
