-- §0.3 P4: documents leave as a tracked step, and an e-signature is confirmed with a one-time code.
--
-- 1. document_sends: one row per document sent to a client on one channel (WhatsApp, email): what, to whom, by whom
--    and whether it left. Delivered, read or failed is read live from the message or notification it created; opened
--    and signed from the signing link. A send that couldn't leave is kept with why, so the team sees it on the job.
-- 2. esign_requests gains when the link was first opened, the signing code (hash, expiry, tries, channel, when it
--    was confirmed) and the signer's device, so the certificate names how the signer was verified.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS document_sends (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  document_kind varchar(30) NOT NULL CHECK (document_kind ~ '^[a-z][a-z_]{1,29}$'),
  document_ref varchar(120) NOT NULL,
  title varchar(300) NOT NULL DEFAULT '',
  channel varchar(10) NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  recipient varchar(200) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL CHECK (status IN ('sent', 'failed')),
  reason varchar(300) NOT NULL DEFAULT '',
  message_id uuid,
  notification_id uuid,
  esign_request_id uuid,
  sent_by uuid REFERENCES users (id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS document_sends_case_idx ON document_sends (workspace_id, case_id, sent_at DESC);
--> statement-breakpoint
ALTER TABLE esign_requests
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS code_hash varchar(64),
  ADD COLUMN IF NOT EXISTS code_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS code_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS code_channel varchar(10) CHECK (code_channel IS NULL OR code_channel IN ('whatsapp', 'email', 'demo')),
  ADD COLUMN IF NOT EXISTS code_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS code_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS signer_device varchar(120);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE document_sends ENABLE ROW LEVEL SECURITY;
  ALTER TABLE document_sends FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'document_sends' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON document_sends
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON document_sends TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES ('document_sends', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
