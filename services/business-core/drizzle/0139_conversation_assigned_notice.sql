-- The person a conversation is assigned to hears it in the app (and on the phone when push is on).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.conversation_assigned', 'in_app', 'en', 1, 'approved', 'Conversation with {{client}} is yours',
       '{{assignedBy}} assigned it to you. Reply from the inbox.', '["client", "assignedBy"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
