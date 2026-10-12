-- Daily progress as day cards. A day's issues and blockers live on after the report: each has an owner, a due date
-- and a state (open → resolved, with who resolved it, when and how), and is version-checked on its own. One tap turns
-- an issue into a snag, a material request (both on the plan) or a change request (a project change, same id).
-- A day already sent to the client can be taken off the client's page again (client_hidden_at) and put back; the
-- email that went is never unsent. Nothing here is a new table: the day card is read from the report tables.
ALTER TABLE site_report_issues
  ADD COLUMN status varchar(10) NOT NULL DEFAULT 'open',
  ADD COLUMN owner_membership_id uuid,
  ADD COLUMN due_on date,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolved_by uuid REFERENCES users (id),
  ADD COLUMN resolution varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN change_request_id uuid,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT site_report_issues_status_check CHECK (status IN ('open', 'resolved')),
  ADD CONSTRAINT site_report_issues_resolved_check CHECK ((status = 'resolved') = (resolved_at IS NOT NULL) AND (resolved_at IS NULL) = (resolved_by IS NULL)),
  ADD CONSTRAINT site_report_issues_version_check CHECK (version > 0),
  ADD CONSTRAINT site_report_issues_owner_fk FOREIGN KEY (workspace_id, owner_membership_id) REFERENCES workspace_memberships (workspace_id, id),
  ADD CONSTRAINT site_report_issues_change_fk FOREIGN KEY (workspace_id, change_request_id) REFERENCES change_requests (workspace_id, id);
--> statement-breakpoint
ALTER TABLE site_report_issues DROP CONSTRAINT site_report_issues_raised_check, DROP CONSTRAINT site_report_issues_check, ALTER COLUMN raised TYPE varchar(16);
--> statement-breakpoint
ALTER TABLE site_report_issues
  ADD CONSTRAINT site_report_issues_raised_check CHECK (raised IS NULL OR raised IN ('snag', 'material', 'change_request')),
  ADD CONSTRAINT site_report_issues_raised_link_check CHECK (
    (raised IS NULL AND work_item_id IS NULL AND change_request_id IS NULL)
    OR (raised IN ('snag', 'material') AND work_item_id IS NOT NULL AND change_request_id IS NULL)
    OR (raised = 'change_request' AND change_request_id IS NOT NULL AND work_item_id IS NULL));
--> statement-breakpoint
CREATE INDEX site_report_issues_open_idx ON site_report_issues (workspace_id, owner_membership_id) WHERE status = 'open';
--> statement-breakpoint
ALTER TABLE site_reports
  ADD COLUMN client_hidden_at timestamptz,
  ADD COLUMN client_hidden_by uuid REFERENCES users (id),
  ADD CONSTRAINT site_reports_client_hidden_check CHECK ((client_hidden_at IS NULL) = (client_hidden_by IS NULL) AND (client_hidden_at IS NULL OR delivery = 'sent'));
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('site.issue_assigned', 'in_app', 'A site issue is yours · {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.issue_resolved', 'in_app', 'Site issue resolved · {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
