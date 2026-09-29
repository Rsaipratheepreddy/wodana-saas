-- D-40: Settings → Projects → Client updates → "Send by itself". The week's drafted client update waits for the
-- project manager; with this set, a draft nobody sent or discarded goes to the client by itself after this many
-- hours (24 by default in the settings screen). NULL keeps every update manual. The table already has forced RLS
-- and a tenant_isolation policy.
ALTER TABLE workspace_project_settings
  ADD COLUMN client_update_auto_send_hours smallint,
  ADD CONSTRAINT workspace_project_settings_client_update_auto_send_check
    CHECK (client_update_auto_send_hours IS NULL OR client_update_auto_send_hours BETWEEN 1 AND 168);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_status_updates_client_drafts_idx ON project_status_updates (workspace_id, created_at)
  WHERE kind = 'client_update' AND approved_at IS NULL;
