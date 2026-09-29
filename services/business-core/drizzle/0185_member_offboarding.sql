-- Offboarding a person (SP-4): their open enquiries, opportunities, follow-ups, chats, clients, planning cases,
-- project tasks and projects go to a successor in one audited command, they leave the assignment queues, their
-- phones stop receiving notices, and their membership is suspended. The successor hears what they took over.
-- No new tables. Idempotent.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'workspace.work_handed_over', 'in_app', 'en', 1, 'approved', '{{memberName}}''s work is yours', '{{note}}', '["memberName", "note"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
