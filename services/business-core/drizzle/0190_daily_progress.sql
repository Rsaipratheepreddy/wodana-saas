-- Daily progress: the site's daily report rebuilt as a short, largely pre-filled capture on the phone, a
-- client-ready card written from it, an approval before anything leaves, and a feed in the client portal.
--
-- The report itself (site_reports) keeps its day, author, status and approval. What's new:
--   * today's planned work with how far each item got (site_report_tasks); submitting applies the progress
--     to the work item (work_items.progress), the same as changing it on the plan;
--   * photos tagged to a room or area, optionally paired before/after, and picked for the client;
--   * crew hours; materials received or used (linked to a delivery when there is one); issues with their
--     severity, whether they stay internal, and the snag or material request raised from them;
--   * tomorrow's plan (site_report_next), pre-filled from the plan;
--   * the client summary (written by Woddy from the structured facts, or from a template), the hero photo,
--     and how the report reached the client: still to send, kept internal, or sent. `client_view` is the
--     immutable snapshot of exactly what the client received, written once when it's sent;
--   * the client's reactions in the portal, and the weekly roll-ups sent to the client.
-- Settings → Projects: when the day's report is due (end of day, workspace time), whether reports nobody
-- reviewed also go to the client by themselves (with D-40's hours), and the weekly roll-up (off by default).
-- Every new table carries workspace_id with forced RLS and the tenant_isolation policy.
ALTER TABLE work_items ADD COLUMN progress smallint;
--> statement-breakpoint
ALTER TABLE work_items ADD CONSTRAINT work_items_progress_check CHECK (progress IS NULL OR progress BETWEEN 0 AND 100);
--> statement-breakpoint
ALTER TABLE site_reports
  ADD COLUMN client_summary varchar(1200) NOT NULL DEFAULT '',
  ADD COLUMN summary_source varchar(8) NOT NULL DEFAULT 'none',
  ADD COLUMN hero_photo_id uuid,
  ADD COLUMN delivery varchar(8) NOT NULL DEFAULT 'pending',
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN sent_by uuid REFERENCES users (id),
  ADD COLUMN sent_automatically boolean NOT NULL DEFAULT false,
  ADD COLUMN client_view jsonb,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT site_reports_summary_source_check CHECK (summary_source IN ('none', 'template', 'ai', 'edited')),
  ADD CONSTRAINT site_reports_delivery_check CHECK (delivery IN ('pending', 'internal', 'sent')),
  ADD CONSTRAINT site_reports_sent_check CHECK ((delivery = 'sent') = (sent_at IS NOT NULL) AND (sent_at IS NULL) = (client_view IS NULL)),
  ADD CONSTRAINT site_reports_sent_status_check CHECK (delivery <> 'sent' OR status IN ('submitted', 'approved')),
  ADD CONSTRAINT site_reports_internal_check CHECK (delivery <> 'internal' OR status = 'approved');
--> statement-breakpoint
-- Reports approved before this change reached the client through the weekly update, if at all: they stay internal,
-- so turning on "Send by itself" never sends old days.
UPDATE site_reports SET delivery = 'internal' WHERE status = 'approved';
--> statement-breakpoint
CREATE INDEX site_reports_delivery_idx ON site_reports (workspace_id, project_id, sent_at DESC) WHERE delivery = 'sent';
--> statement-breakpoint
CREATE INDEX site_reports_to_send_idx ON site_reports (workspace_id, status, decided_at) WHERE delivery = 'pending' AND status IN ('submitted', 'approved');
--> statement-breakpoint
ALTER TABLE site_report_workforce ADD COLUMN hours numeric(5, 2);
--> statement-breakpoint
ALTER TABLE site_report_workforce ADD CONSTRAINT site_report_workforce_hours_check CHECK (hours IS NULL OR (hours > 0 AND hours <= 24));
--> statement-breakpoint
-- A photo's room or area (one of the project's rooms), before or after, the photo it pairs with, and whether the
-- client gets it. The portal only ever shows a photo once its report was sent (shared_at).
ALTER TABLE site_report_photos
  ADD COLUMN area_id uuid,
  ADD COLUMN phase varchar(6),
  ADD COLUMN pair_id uuid,
  ADD COLUMN for_client boolean NOT NULL DEFAULT false,
  ADD COLUMN position smallint NOT NULL DEFAULT 0,
  ADD CONSTRAINT site_report_photos_phase_check CHECK (phase IS NULL OR phase IN ('before', 'after')),
  ADD CONSTRAINT site_report_photos_pair_check CHECK (pair_id IS NULL OR pair_id <> id),
  ADD CONSTRAINT site_report_photos_pair_fk FOREIGN KEY (workspace_id, pair_id) REFERENCES site_report_photos (workspace_id, id) ON DELETE SET NULL (pair_id);
--> statement-breakpoint
ALTER TABLE site_reports ADD CONSTRAINT site_reports_hero_fk FOREIGN KEY (workspace_id, hero_photo_id) REFERENCES site_report_photos (workspace_id, id) ON DELETE SET NULL (hero_photo_id);
--> statement-breakpoint
-- Today's planned work and how far each item got (0–100; 100 is done). `previous` is the item's progress when
-- the report was written, so the day's movement reads without the plan's history.
CREATE TABLE site_report_tasks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  work_item_id uuid NOT NULL,
  progress smallint NOT NULL CHECK (progress BETWEEN 0 AND 100),
  previous smallint CHECK (previous IS NULL OR previous BETWEEN 0 AND 100),
  note varchar(500) NOT NULL DEFAULT '',
  hidden boolean NOT NULL DEFAULT false,
  position smallint NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, report_id, work_item_id),
  FOREIGN KEY (workspace_id, report_id) REFERENCES site_reports (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items (workspace_id, id)
);
--> statement-breakpoint
-- Tomorrow's plan: the plan's work for the next working day, trimmed or added to by the supervisor.
CREATE TABLE site_report_next (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  work_item_id uuid,
  title varchar(300) NOT NULL CHECK (length(btrim(title)) > 0),
  hidden boolean NOT NULL DEFAULT false,
  position smallint NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, report_id) REFERENCES site_reports (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items (workspace_id, id)
);
--> statement-breakpoint
-- Materials received on site or used that day; a delivery (order or stock move) when there is one. Internal only.
CREATE TABLE site_report_materials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  direction varchar(8) NOT NULL CHECK (direction IN ('received', 'used')),
  description varchar(300) NOT NULL CHECK (length(btrim(description)) > 0),
  quantity numeric(18, 4) CHECK (quantity IS NULL OR quantity > 0),
  unit varchar(20) NOT NULL DEFAULT '',
  purchase_order_id uuid,
  stock_transfer_id uuid,
  position smallint NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, report_id) REFERENCES site_reports (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, purchase_order_id) REFERENCES purchase_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, stock_transfer_id) REFERENCES stock_transfers (workspace_id, id),
  CHECK (purchase_order_id IS NULL OR stock_transfer_id IS NULL)
);
--> statement-breakpoint
-- Issues and blockers found that day. Internal ones never reach the client; a snag or a material request raised
-- from one is the real work item (created through the work command with the issue's id).
CREATE TABLE site_report_issues (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  severity varchar(10) NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
  description varchar(1000) NOT NULL CHECK (length(btrim(description)) > 0),
  internal boolean NOT NULL DEFAULT true,
  raised varchar(10) CHECK (raised IS NULL OR raised IN ('snag', 'material')),
  work_item_id uuid,
  position smallint NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, report_id) REFERENCES site_reports (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, work_item_id) REFERENCES work_items (workspace_id, id),
  CHECK ((raised IS NULL) = (work_item_id IS NULL))
);
--> statement-breakpoint
-- A client's reaction to a sent daily card in the portal: one of each kind per contact.
CREATE TABLE site_report_reactions (
  workspace_id uuid NOT NULL,
  report_id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES client_portal_grants (id) ON DELETE CASCADE,
  reaction varchar(8) NOT NULL CHECK (reaction IN ('like', 'love')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, report_id, grant_id, reaction),
  FOREIGN KEY (workspace_id, report_id) REFERENCES site_reports (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- The weekly roll-up sent to the client: once per project and week (the week ends on the workspace's last working day).
CREATE TABLE site_report_rollups (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  week_ending date NOT NULL,
  report_count integer NOT NULL CHECK (report_count > 0),
  digest varchar(2000) NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, week_ending),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id)
);
--> statement-breakpoint
ALTER TABLE workspace_project_settings
  ADD COLUMN report_due_time time NOT NULL DEFAULT '18:00',
  ADD COLUMN auto_send_pending_reports boolean NOT NULL DEFAULT false,
  ADD COLUMN weekly_rollup boolean NOT NULL DEFAULT false;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_report_tasks', 'site_report_next', 'site_report_materials', 'site_report_issues', 'site_report_reactions', 'site_report_rollups'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON site_report_tasks, site_report_next, site_report_materials, site_report_issues, site_report_reactions TO wodana_app;
    GRANT SELECT, INSERT ON site_report_rollups TO wodana_app;
    GRANT UPDATE ON site_report_photos TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('site.report_late', 'in_app', 'No site report today · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.report_approved', 'in_app', 'Your report was approved · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.report_sent', 'in_app', '{{title}}: the daily progress went to the client', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.material_requested', 'in_app', 'Material needed on site · {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.client_reacted', 'in_app', '{{actor}} reacted to the daily progress · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.client_question', 'in_app', '{{actor}} asked about the daily progress · {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('site.client_question', 'email', '{{actor}} asked about the daily progress · {{title}}', E'{{actor}} asked about the daily progress on {{title}}:\n\n{{note}}\n\nAnswer in the conversation on the project.', '["title", "clientName", "actor", "note"]'),
  ('portal.daily_progress', 'email', '{{project}} · {{title}}', E'{{note}}\n\nOpen your project page to see the photos.', '["company", "project", "title", "due", "note"]'),
  ('portal.weekly_rollup', 'email', '{{project}} · {{title}}', E'{{note}}\n\nOpen your project page to see every day of the week.', '["company", "project", "title", "due", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
