-- A command a person confirmed through Woddy (W-1) is audited like any other, and its audit rows say where it
-- came from: `via` ('woddy'; an MCP client later) and the AI run. Business Core sets app.command_via and
-- app.ai_run_id for the confirmed command's transaction only, so every audit row written in it carries them,
-- whichever module writes the row. Both are NULL for everything else, including every existing row.
ALTER TABLE audit_events
  ADD COLUMN via varchar(20) DEFAULT NULLIF(current_setting('app.command_via', true), ''),
  ADD COLUMN ai_run_id uuid DEFAULT NULLIF(current_setting('app.ai_run_id', true), '')::uuid;
--> statement-breakpoint
CREATE INDEX audit_events_ai_run_idx ON audit_events (workspace_id, ai_run_id) WHERE ai_run_id IS NOT NULL;
