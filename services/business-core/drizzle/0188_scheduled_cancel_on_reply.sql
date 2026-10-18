-- A follow-up that cancels itself when the client replies first (X-1). A scheduled chat message is cancelled
-- when the client writes before it goes, unless whoever scheduled it chose to send it anyway, and they are told.
-- The table already has forced RLS and a tenant_isolation policy; wodana_app keeps its grants. Idempotent.
ALTER TABLE crm_scheduled_messages
  ADD COLUMN IF NOT EXISTS cancel_on_reply boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancel_reason varchar(40);
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.inbox_scheduled_cancelled', 'in_app', 'en', 1, 'approved', '{{clientName}} replied first',
       'Your scheduled message was cancelled so it doesn''t land on top of their reply: "{{preview}}"', '["clientName", "preview"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
