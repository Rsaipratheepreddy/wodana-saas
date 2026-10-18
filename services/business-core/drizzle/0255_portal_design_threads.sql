-- One design conversation for the team and the client (plan §5c F.10): the pinned, threaded comments on a design
-- revision are the same rows in the staff Design tab and in the client portal.
--   * A thread or a reply is written by a staff user (created_by) or by a client portal contact (client_grant_id),
--     never both; the same pattern as warranty_claims.
--   * client_visible: the client sees the thread (every thread the client starts; a team thread when the team shares it).
--   * A client contact may resolve the threads their side started (resolved_by_grant_id).
--   * A team thread starts internal (staff only); the team shares it with the client with the audience switch.
-- Idempotent; runs as the migration owner, so forced RLS is never disabled.
ALTER TABLE pre_project_design_threads
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS client_grant_id uuid,
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS resolved_by_grant_id uuid;
--> statement-breakpoint
ALTER TABLE pre_project_design_messages
  ALTER COLUMN created_by DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS client_grant_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pre_project_design_threads_author_check') THEN
    ALTER TABLE pre_project_design_threads
      ADD CONSTRAINT pre_project_design_threads_author_check CHECK ((created_by IS NULL) <> (client_grant_id IS NULL)),
      ADD CONSTRAINT pre_project_design_threads_client_visible_check CHECK (client_grant_id IS NULL OR client_visible),
      ADD CONSTRAINT pre_project_design_threads_client_grant_fkey FOREIGN KEY (workspace_id, case_id, client_grant_id)
        REFERENCES client_portal_grants (workspace_id, case_id, id),
      ADD CONSTRAINT pre_project_design_threads_resolved_grant_fkey FOREIGN KEY (workspace_id, case_id, resolved_by_grant_id)
        REFERENCES client_portal_grants (workspace_id, case_id, id);
    ALTER TABLE pre_project_design_messages
      ADD CONSTRAINT pre_project_design_messages_author_check CHECK ((created_by IS NULL) <> (client_grant_id IS NULL)),
      ADD CONSTRAINT pre_project_design_messages_client_grant_fkey FOREIGN KEY (workspace_id, case_id, client_grant_id)
        REFERENCES client_portal_grants (workspace_id, case_id, id);
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS pre_project_design_threads_client_idx ON pre_project_design_threads (workspace_id, case_id) WHERE client_visible;
--> statement-breakpoint
-- The team hears a client's design comment (in the app, and by email for a new one).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.client_commented', 'in_app', '{{actor}} commented on {{item}}', '{{clientName}}: {{note}}', '["title","clientName","actor","item","note"]'),
  ('design.client_commented', 'email', 'New design comment · {{clientName}}', E'{{actor}} commented on {{item}} ({{title}}):\n\n{{note}}\n\nOpen the design to reply.', '["title","clientName","actor","item","note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
