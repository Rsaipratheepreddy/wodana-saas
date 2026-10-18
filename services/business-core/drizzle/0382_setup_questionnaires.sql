-- §0.3 P3, the Setup module: questionnaires the firm edits and publishes itself (the kick-off, the handover checklist,
-- a warranty claim).
--
-- 1. setup_questionnaires: one per purpose per workspace. The draft the firm admin is editing (configuration JSON),
--    its revision (version check) and the number of the version last published (0 = the kit's questions).
-- 2. setup_questionnaire_versions: each published version, never changed after (a rollback publishes a new number).
-- 3. setup_questionnaire_answers: a job's answers, one row per question, with the version it answered and the question
--    as it was asked. A job keeps the version it first answered.
-- Every table is workspace-scoped with forced RLS and tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS setup_questionnaires (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  purpose varchar(30) NOT NULL CHECK (purpose IN ('kickoff', 'handover', 'warranty_claim')),
  draft jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(draft) = 'array'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_number integer NOT NULL DEFAULT 0 CHECK (published_number >= 0),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, purpose)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS setup_questionnaire_versions (
  workspace_id uuid NOT NULL,
  purpose varchar(30) NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  questions jsonb NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  note varchar(500) NOT NULL DEFAULT '',
  published_by uuid NOT NULL REFERENCES users (id),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, purpose, number),
  FOREIGN KEY (workspace_id, purpose) REFERENCES setup_questionnaires (workspace_id, purpose) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS setup_questionnaire_answers (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  purpose varchar(30) NOT NULL CHECK (purpose IN ('kickoff', 'handover', 'warranty_claim')),
  subject_type varchar(30) NOT NULL CHECK (subject_type IN ('case', 'handover_pack', 'warranty_claim')),
  subject_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 0),
  question_key varchar(60) NOT NULL,
  question_label varchar(300) NOT NULL,
  answer text,
  answered_by uuid REFERENCES users (id),
  answered_by_name varchar(200),
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, purpose, subject_type, subject_id, question_key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS setup_questionnaire_answers_subject_idx ON setup_questionnaire_answers (workspace_id, subject_type, subject_id);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['setup_questionnaires', 'setup_questionnaire_versions', 'setup_questionnaire_answers'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = table_name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('setup_questionnaires', 'keep', NULL, '{}'),
  ('setup_questionnaire_versions', 'keep', NULL, '{}'),
  ('setup_questionnaire_answers', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
