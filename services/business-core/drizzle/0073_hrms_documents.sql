-- HRMS H3: people's documents (identity, work permits, licences, inductions…) with expiry dates, and
-- who may go to each project's site. The workspace chooses which kinds a person needs on site; anyone
-- missing one, or holding an expired one, isn't cleared.
CREATE TABLE hrms_documents (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  membership_id uuid,
  worker_id uuid,
  kind varchar(24) NOT NULL CONSTRAINT hrms_documents_kind_check CHECK (kind IN ('identity', 'work_permit', 'residence', 'licence', 'insurance', 'safety_induction', 'medical', 'other')),
  title varchar(120) NOT NULL CONSTRAINT hrms_documents_title_check CHECK (length(btrim(title)) > 0),
  number varchar(80) NOT NULL DEFAULT '',
  issued_on date,
  expires_on date,
  object_key text,
  file_name varchar(200),
  content_type varchar(100),
  byte_size integer,
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_documents_workspace_id_id_key UNIQUE (workspace_id, id),
  CONSTRAINT hrms_documents_subject_check CHECK (num_nonnulls(membership_id, worker_id) = 1),
  CONSTRAINT hrms_documents_dates_check CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on),
  CONSTRAINT hrms_documents_file_check CHECK ((object_key IS NULL) = (file_name IS NULL)),
  CONSTRAINT hrms_documents_member_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES workspace_memberships(workspace_id, id),
  CONSTRAINT hrms_documents_worker_fkey FOREIGN KEY (workspace_id, worker_id) REFERENCES hrms_workers(workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX hrms_documents_subject_idx ON hrms_documents (workspace_id, membership_id, worker_id);
--> statement-breakpoint
CREATE INDEX hrms_documents_expiry_idx ON hrms_documents (workspace_id, expires_on) WHERE expires_on IS NOT NULL;
--> statement-breakpoint
ALTER TABLE hrms_settings ADD COLUMN site_documents varchar(24)[] NOT NULL DEFAULT '{}'
  CONSTRAINT hrms_settings_site_documents_check CHECK (site_documents <@ ARRAY['identity', 'work_permit', 'residence', 'licence', 'insurance', 'safety_induction', 'medical', 'other']::varchar(24)[]);
--> statement-breakpoint
-- Who may go to a project's site: a crew (all its active workers), a worker, or a member of staff.
CREATE TABLE hrms_site_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL,
  crew_id uuid,
  worker_id uuid,
  membership_id uuid,
  added_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_site_access_subject_check CHECK (num_nonnulls(crew_id, worker_id, membership_id) = 1),
  CONSTRAINT hrms_site_access_project_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects(workspace_id, id),
  CONSTRAINT hrms_site_access_crew_fkey FOREIGN KEY (workspace_id, crew_id) REFERENCES hrms_crews(workspace_id, id),
  CONSTRAINT hrms_site_access_worker_fkey FOREIGN KEY (workspace_id, worker_id) REFERENCES hrms_workers(workspace_id, id),
  CONSTRAINT hrms_site_access_member_fkey FOREIGN KEY (workspace_id, membership_id) REFERENCES workspace_memberships(workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX hrms_site_access_key ON hrms_site_access (workspace_id, project_id, coalesce(crew_id, worker_id, membership_id));
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hrms_documents', 'hrms_site_access'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON hrms_documents, hrms_site_access TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body,
       '["person", "leaveType", "dates", "days", "note", "actor", "when", "place"]'::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('hrms.document_expiring', 'in_app', 'Expires soon: {{person}}''s {{note}}', 'Expires on {{dates}}. Ask for the new one.'),
  ('hrms.document_expiring', 'email', 'Expires soon: {{person}}''s {{note}}', E'{{person}}''s {{note}} expires on {{dates}}.\n\nAsk for the new one and add it to their documents.'),
  ('hrms.document_expired', 'in_app', 'Expired: {{person}}''s {{note}}', 'It expired on {{dates}}. They can''t be cleared for site until it''s renewed.')
) AS template (code, channel, subject, body)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
