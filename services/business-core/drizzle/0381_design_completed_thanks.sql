-- §0.3 P0 (guide J): a design-only job (Full ID) ends at the client's design approval: the client is thanked by the
-- firm's branded email (and sees it in their portal). The default English template for every workspace. Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'portal.design_completed', 'email', 'en', 1, 'approved', 'Your design is complete · {{project}}',
       E'Thank you for choosing {{company}}. Your design for {{project}} is approved and complete.\n\n{{note}}\n\nYour drawings, renders and decisions stay in your project page.',
       '["company","project","title","due","note"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
