-- PLM-153: minutes of every client meeting, shared through the client portal (not WhatsApp).
--
-- 1. meeting_minutes: one set of minutes per meeting (a CRM meeting or call with its appointment: the intro, the
--    kick-off, a site visit, a sample meeting, value engineering, a client update call...). The text, the files kept
--    on it, who wrote it, and whether it is shared with the client. Its version guards concurrent edits.
-- 2. meeting_minutes_revisions: every saved version (text, files, shared or not, who and when). Edits after sharing
--    keep the earlier versions.
-- 3. meeting_minutes_files: photos and PDFs added to a meeting's minutes; a revision lists the ones it keeps.
-- 4. meeting_minutes_comments: the client's comments in the portal and the team's replies.
-- 5. The portal's Meetings section: shown by default (client_portal_settings.show_meetings); a project that narrowed
--    its sections keeps Meetings wherever it shows Messages (the client's communication).
-- 6. The notices: the client hears the minutes are shared (branded email), the author hears the client's comment.
-- 7. The go-live reset clears the new records (the files with their stored objects).
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS meeting_minutes (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES crm_activities (id) ON DELETE CASCADE,
  title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
  body text NOT NULL CHECK (length(body) <= 20000),
  file_ids uuid[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  shared_at timestamptz,
  shared_by uuid REFERENCES users (id),
  shared_revision integer,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, activity_id),
  CHECK ((shared_at IS NULL) = (shared_revision IS NULL)),
  CHECK (cardinality(file_ids) <= 20)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS meeting_minutes_revisions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  minutes_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  title varchar(200) NOT NULL,
  body text NOT NULL,
  file_ids uuid[] NOT NULL DEFAULT '{}',
  shared boolean NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, minutes_id, revision),
  FOREIGN KEY (workspace_id, minutes_id) REFERENCES meeting_minutes (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS meeting_minutes_files (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  activity_id uuid NOT NULL REFERENCES crm_activities (id) ON DELETE CASCADE,
  original_name varchar(255) NOT NULL DEFAULT '',
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS meeting_minutes_files_activity_idx ON meeting_minutes_files (workspace_id, activity_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS meeting_minutes_comments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  minutes_id uuid NOT NULL,
  case_id uuid,
  grant_id uuid,
  author_user_id uuid REFERENCES users (id),
  body varchar(2000) NOT NULL CHECK (length(btrim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, minutes_id) REFERENCES meeting_minutes (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id, grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CHECK ((grant_id IS NULL) <> (author_user_id IS NULL)),
  CHECK (grant_id IS NULL OR case_id IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS meeting_minutes_comments_minutes_idx ON meeting_minutes_comments (workspace_id, minutes_id, created_at);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['meeting_minutes', 'meeting_minutes_revisions', 'meeting_minutes_files', 'meeting_minutes_comments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- Minutes are edited (each save is a new revision kept below); revisions, files and comments are only added.
    GRANT SELECT, INSERT, UPDATE ON meeting_minutes TO wodana_app;
    GRANT SELECT, INSERT ON meeting_minutes_revisions, meeting_minutes_files, meeting_minutes_comments TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE client_portal_settings ADD COLUMN IF NOT EXISTS show_meetings boolean NOT NULL DEFAULT true;
--> statement-breakpoint
-- The project sections allowed: whatever the latest definition lists, and meetings (added, never narrowed, so a section
-- another release added stays allowed).
DO $$
DECLARE
  definition text;
  allowed text[];
BEGIN
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conname = 'client_portal_project_access_sections_check' AND conrelid = 'client_portal_project_access'::regclass;
  SELECT coalesce(array_agg(DISTINCT match[1]), '{}') INTO allowed FROM regexp_matches(coalesce(definition, ''), '''([a-z_]+)''', 'g') AS match;
  IF NOT 'meetings' = ANY (allowed) THEN
    allowed := allowed || ARRAY['meetings'];
    IF definition IS NOT NULL THEN ALTER TABLE client_portal_project_access DROP CONSTRAINT client_portal_project_access_sections_check; END IF;
    EXECUTE format('ALTER TABLE client_portal_project_access ADD CONSTRAINT client_portal_project_access_sections_check CHECK (sections IS NULL OR sections <@ ARRAY[%s]::text[])',
      (SELECT string_agg(quote_literal(section), ', ') FROM unnest(allowed) AS section));
  END IF;
END $$;
--> statement-breakpoint
UPDATE client_portal_project_access SET sections = array_append(sections, 'meetings'::text)
 WHERE sections IS NOT NULL AND 'messages' = ANY (sections) AND NOT ('meetings' = ANY (sections));
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('portal.minutes_shared', 'email', 'Notes from your meeting · {{project}}', E'{{company}} shared the notes from {{title}}.\n\n{{note}}\n\nOpen your project page to read them and comment.', '["company","project","title","due","note"]'),
  ('meeting.minutes_comment', 'in_app', '{{actor}} commented on the minutes · {{title}}', '{{note}}', '["title","clientName","actor","note"]'),
  ('meeting.minutes_comment', 'email', '{{actor}} commented on the minutes of {{title}}', E'{{actor}} commented on the minutes of {{title}} in the client portal:\n\n{{note}}\n\nOpen the meeting to reply.', '["title","clientName","actor","note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('meeting_minutes', 'clear', NULL, '{}'),
  ('meeting_minutes_revisions', 'clear', NULL, '{}'),
  ('meeting_minutes_files', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('meeting_minutes_comments', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
