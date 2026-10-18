-- PLM-179: the weekly client update is a call or a written update in the client portal, as the firm sets it.
--   * workspace_project_settings.client_update_mode / client_update_frequency: how a job's client updates start (when
--     the design is approved, or the estimate accepted without design): by call, by a portal update, or either; and how
--     often (off: they don't start). The defaults keep today's behaviour: weekly, by call.
--   * client_update_calls.mode gains 'either': a planned update is done by a logged call with the client or by a
--     progress update shared in the portal, whichever comes first; no call is booked for it.
--   * The notice the Account Manager gets on the day an update is due in 'either' mode, for every workspace.
-- Existing jobs keep their mode and rhythm. RLS untouched. Idempotent.
ALTER TABLE workspace_project_settings
  ADD COLUMN IF NOT EXISTS client_update_mode varchar(8) NOT NULL DEFAULT 'call',
  ADD COLUMN IF NOT EXISTS client_update_frequency varchar(12) NOT NULL DEFAULT 'weekly';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_project_settings_client_update_mode_check') THEN
    ALTER TABLE workspace_project_settings ADD CONSTRAINT workspace_project_settings_client_update_mode_check CHECK (client_update_mode IN ('call', 'portal', 'either'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_project_settings_client_update_frequency_check') THEN
    ALTER TABLE workspace_project_settings ADD CONSTRAINT workspace_project_settings_client_update_frequency_check
      CHECK (client_update_frequency IN ('weekly', 'fortnightly', 'monthly', 'off'));
  END IF;
  ALTER TABLE client_update_calls DROP CONSTRAINT IF EXISTS client_update_calls_mode_check;
  ALTER TABLE client_update_calls ADD CONSTRAINT client_update_calls_mode_check CHECK (mode IN ('call', 'portal', 'either'));
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('client_calls.update_due', 'in_app', 'Update {{clientName}} today', 'Call them, or share a progress update in the portal ({{frequency}}).', '["clientName","frequency","when"]'),
  ('client_calls.update_due', 'email', 'Client update due: {{clientName}}', E'{{clientName}} hears how the work goes from a call with you or a progress update in the client portal ({{frequency}}).\n\nLog the call or share an update today.', '["clientName","frequency","when"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
