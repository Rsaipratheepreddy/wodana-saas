-- One reminder system for a change waiting on the client (plan §6.20, §6.24a): the reminder engine's
-- change_request.client_decision kind (registered by the change-request module) replaces the daily change reminder and
-- the separate "change reminder days" project setting.
--   * A firm that changed those days from the default (3 and 7) keeps them: they become its rule's offsets for the kind
--     (ascending, at most six); a firm that cleared them gets the kind switched off. Firms on the default follow the
--     engine's default (2 and 5 days, a staff copy to the project manager after two). A firm that already has a rule
--     for the kind keeps it.
--   * workspace_project_settings.change_reminder_days is dropped (nothing reads it any more), and the old
--     change_request.reminder templates go with the sender that used them.
-- reminder_rules keeps its forced RLS and tenant_isolation policy (0289). Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'workspace_project_settings' AND column_name = 'change_reminder_days') THEN
    INSERT INTO reminder_rules (workspace_id, kind, enabled, offsets, unit, working_days, escalate_after, chain, channels, digest)
    SELECT settings.workspace_id, 'change_request.client_decision', cardinality(settings.change_reminder_days) > 0,
           CASE WHEN cardinality(settings.change_reminder_days) > 0
             THEN (SELECT array_agg(day ORDER BY day) FROM (
                     SELECT DISTINCT day FROM unnest(settings.change_reminder_days::integer[]) AS day WHERE day BETWEEN 1 AND 90 ORDER BY day LIMIT 6) capped)
             ELSE ARRAY[2, 5] END,
           'day', false, 2, '{}', ARRAY['whatsapp', 'email'], false
      FROM workspace_project_settings settings
     WHERE settings.change_reminder_days IS DISTINCT FROM '{3,7}'::smallint[]
    ON CONFLICT (workspace_id, kind) DO NOTHING;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE workspace_project_settings DROP CONSTRAINT IF EXISTS workspace_project_settings_change_reminder_days_check;
--> statement-breakpoint
ALTER TABLE workspace_project_settings DROP COLUMN IF EXISTS change_reminder_days;
--> statement-breakpoint
DELETE FROM notification_templates WHERE code = 'change_request.reminder';
