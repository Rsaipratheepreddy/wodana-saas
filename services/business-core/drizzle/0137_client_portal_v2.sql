-- The client portal as a working place for the client (plan §6.22): the moodboard they react to and add to,
-- files they attach, the payments they report, the issues they raise and what they have read.
--
-- A client adds inspirations and files as themselves: brief entries and files may have no staff author when a
-- client portal contact (their grant) wrote them. Everything below is tenant data under forced RLS.
ALTER TABLE pre_project_brief_entries ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE pre_project_brief_entries ALTER COLUMN updated_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE pre_project_brief_entries ADD COLUMN client_grant_id uuid;
--> statement-breakpoint
ALTER TABLE pre_project_brief_entries ADD CONSTRAINT pre_project_brief_entries_client_grant_fk
  FOREIGN KEY (workspace_id, case_id, client_grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id);
--> statement-breakpoint
-- Only a client's own inspiration is written without a staff author.
ALTER TABLE pre_project_brief_entries ADD CONSTRAINT pre_project_brief_entries_author_check
  CHECK (created_by IS NOT NULL OR (client_grant_id IS NOT NULL AND source = 'client' AND kind = 'inspiration'));
--> statement-breakpoint
ALTER TABLE pre_project_brief_entries ADD CONSTRAINT pre_project_brief_entries_updater_check CHECK (updated_by IS NOT NULL OR client_grant_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE pre_project_brief_assets ALTER COLUMN created_by DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE pre_project_brief_assets ADD COLUMN client_grant_id uuid;
--> statement-breakpoint
ALTER TABLE pre_project_brief_assets ADD CONSTRAINT pre_project_brief_assets_client_grant_fk
  FOREIGN KEY (workspace_id, case_id, client_grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id);
--> statement-breakpoint
ALTER TABLE pre_project_brief_assets ADD CONSTRAINT pre_project_brief_assets_author_check CHECK (created_by IS NOT NULL OR client_grant_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX pre_project_brief_assets_client_idx ON pre_project_brief_assets (workspace_id, client_grant_id, created_at) WHERE client_grant_id IS NOT NULL;
--> statement-breakpoint

-- The moodboard pins the team shows the client (a client's own pins are always theirs to see).
CREATE TABLE pre_project_moodboard_shares (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  case_id uuid NOT NULL,
  entry_id uuid NOT NULL,
  shared_by uuid NOT NULL REFERENCES users (id),
  shared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, entry_id),
  FOREIGN KEY (workspace_id, case_id, entry_id) REFERENCES pre_project_brief_entries (workspace_id, case_id, id)
);
--> statement-breakpoint
CREATE INDEX pre_project_moodboard_shares_case_idx ON pre_project_moodboard_shares (workspace_id, case_id);
--> statement-breakpoint

-- A client's like or dislike of a moodboard pin or a concept board (a design version), one per contact.
CREATE TABLE client_portal_reactions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  case_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  target_kind varchar(10) NOT NULL,
  target_id uuid NOT NULL,
  reaction varchar(8) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, grant_id, target_kind, target_id),
  FOREIGN KEY (workspace_id, case_id, grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CONSTRAINT client_portal_reactions_target_check CHECK (target_kind IN ('pin', 'design')),
  CONSTRAINT client_portal_reactions_reaction_check CHECK (reaction IN ('like', 'dislike'))
);
--> statement-breakpoint
CREATE INDEX client_portal_reactions_target_idx ON client_portal_reactions (workspace_id, case_id, target_kind, target_id);
--> statement-breakpoint

-- Comments on a moodboard pin or concept board: the client's, and the design team's replies.
CREATE TABLE client_portal_board_comments (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  target_kind varchar(10) NOT NULL,
  target_id uuid NOT NULL,
  grant_id uuid,
  author_user_id uuid REFERENCES users (id),
  body varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id, grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CONSTRAINT client_portal_board_comments_target_check CHECK (target_kind IN ('pin', 'design')),
  CONSTRAINT client_portal_board_comments_author_check CHECK ((grant_id IS NULL) <> (author_user_id IS NULL)),
  CONSTRAINT client_portal_board_comments_body_check CHECK (length(btrim(body)) > 0)
);
--> statement-breakpoint
CREATE INDEX client_portal_board_comments_target_idx ON client_portal_board_comments (workspace_id, case_id, target_kind, target_id, created_at);
--> statement-breakpoint

-- A file the client attached to something they sent: a message, a decision, a payment report, a warranty claim or an issue.
-- One file belongs to one thing.
CREATE TABLE client_portal_attachments (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  case_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  target_kind varchar(20) NOT NULL,
  target_id varchar(80) NOT NULL,
  grant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, asset_id),
  FOREIGN KEY (workspace_id, case_id, asset_id) REFERENCES pre_project_brief_assets (workspace_id, case_id, id),
  FOREIGN KEY (workspace_id, case_id, grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CONSTRAINT client_portal_attachments_target_check CHECK (target_kind IN ('message', 'decision', 'payment', 'warranty_claim', 'issue'))
);
--> statement-breakpoint
CREATE INDEX client_portal_attachments_target_idx ON client_portal_attachments (workspace_id, case_id, target_kind, target_id);
--> statement-breakpoint

-- "I've paid": what the client says they paid on a milestone, with a reference and proof. It is the client's claim,
-- never a receipt: finance records the receipt through the finance ledger, or says it wasn't received and why.
CREATE TABLE client_portal_payment_notices (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  payment_id varchar(80) NOT NULL,
  grant_id uuid NOT NULL,
  amount numeric(18, 4),
  currency varchar(3),
  paid_on date NOT NULL,
  reference varchar(120) NOT NULL DEFAULT '',
  note varchar(1000) NOT NULL DEFAULT '',
  status varchar(14) NOT NULL DEFAULT 'submitted',
  decision_note varchar(1000) NOT NULL DEFAULT '',
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id, grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CONSTRAINT client_portal_payment_notices_status_check CHECK (status IN ('submitted', 'recorded', 'not_received')),
  CONSTRAINT client_portal_payment_notices_decided_check CHECK ((status = 'submitted') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT client_portal_payment_notices_amount_check CHECK (amount IS NULL OR amount > 0),
  CONSTRAINT client_portal_payment_notices_reason_check CHECK (status <> 'not_received' OR length(btrim(decision_note)) > 0),
  CONSTRAINT client_portal_payment_notices_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX client_portal_payment_notices_case_idx ON client_portal_payment_notices (workspace_id, case_id, payment_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX client_portal_payment_notices_open_idx ON client_portal_payment_notices (workspace_id, created_at) WHERE status = 'submitted';
--> statement-breakpoint

-- An issue the client reports before handover (a chipped panel during installation): the project manager triages
-- it into a snag (with a severity) or declines it with a reason the client reads.
CREATE TABLE client_portal_issues (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  project_id uuid NOT NULL,
  number integer NOT NULL,
  grant_id uuid NOT NULL,
  raised_on date NOT NULL,
  description varchar(2000) NOT NULL,
  area_id uuid,
  status varchar(10) NOT NULL DEFAULT 'to_triage',
  severity varchar(10),
  decision_note varchar(1000) NOT NULL DEFAULT '',
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  snag_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, project_id, number),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id, grant_id) REFERENCES client_portal_grants (workspace_id, case_id, id),
  CONSTRAINT client_portal_issues_status_check CHECK (status IN ('to_triage', 'accepted', 'declined')),
  CONSTRAINT client_portal_issues_severity_check CHECK (severity IS NULL OR severity IN ('minor', 'major', 'critical')),
  CONSTRAINT client_portal_issues_decided_check CHECK ((status = 'to_triage') = (decided_at IS NULL) AND (decided_at IS NULL) = (decided_by IS NULL)),
  CONSTRAINT client_portal_issues_accepted_check CHECK (status <> 'accepted' OR (severity IS NOT NULL AND snag_id IS NOT NULL)),
  CONSTRAINT client_portal_issues_declined_check CHECK (status <> 'declined' OR length(btrim(decision_note)) > 0),
  CONSTRAINT client_portal_issues_description_check CHECK (length(btrim(description)) > 0),
  CONSTRAINT client_portal_issues_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX client_portal_issues_project_idx ON client_portal_issues (workspace_id, project_id, number DESC);
--> statement-breakpoint

-- When a conversation was last read, by the client contact and by the team (read state on both sides).
CREATE TABLE client_portal_reads (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  case_id uuid NOT NULL,
  thread_id varchar(80) NOT NULL,
  reader_kind varchar(6) NOT NULL,
  reader_id uuid NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, thread_id, reader_kind, reader_id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id),
  CONSTRAINT client_portal_reads_kind_check CHECK (reader_kind IN ('client', 'team'))
);
--> statement-breakpoint

-- The moodboard is a portal section like the others: shown by default, and a project can narrow it away.
ALTER TABLE client_portal_settings ADD COLUMN show_moodboard boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE client_portal_project_access DROP CONSTRAINT client_portal_project_access_sections_check;
--> statement-breakpoint
ALTER TABLE client_portal_project_access ADD CONSTRAINT client_portal_project_access_sections_check
  CHECK (sections IS NULL OR sections <@ ARRAY['progress', 'moodboard', 'decisions', 'payments', 'documents', 'warranty', 'messages']::text[]);
--> statement-breakpoint

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['pre_project_moodboard_shares', 'client_portal_reactions', 'client_portal_board_comments', 'client_portal_attachments',
    'client_portal_payment_notices', 'client_portal_issues', 'client_portal_reads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, DELETE ON pre_project_moodboard_shares TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_portal_reactions TO wodana_app;
    GRANT SELECT, INSERT ON client_portal_board_comments TO wodana_app;
    GRANT SELECT, INSERT ON client_portal_attachments TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON client_portal_payment_notices TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON client_portal_issues TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON client_portal_reads TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint

-- Who hears what the client did (client-portal/portal-notices.ts): the designer and account manager for the moodboard,
-- finance and the project managers for a reported payment, the project managers for an issue; the client hears the
-- team's reply on the moodboard and the result of a payment report.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('moodboard.client_reacted', 'in_app', '{{actor}} {{reaction}} {{item}}', '{{title}}', '["title", "clientName", "actor", "item", "reaction", "note"]'),
  ('moodboard.client_commented', 'in_app', '{{actor}} commented on {{item}}', '{{note}}', '["title", "clientName", "actor", "item", "reaction", "note"]'),
  ('moodboard.client_commented', 'email', '{{actor}} commented on {{item}}', '{{actor}} commented on {{item}} ({{title}}):

{{note}}', '["title", "clientName", "actor", "item", "reaction", "note"]'),
  ('moodboard.client_added', 'in_app', '{{actor}} added an inspiration', '{{item}} on {{title}}. {{note}}', '["title", "clientName", "actor", "item", "reaction", "note"]'),
  ('payment.client_reported', 'in_app', '{{actor}} says they paid {{milestone}}', '{{title}}: {{amount}} on {{paidOn}}. Reference {{reference}}.', '["title", "clientName", "actor", "milestone", "amount", "paidOn", "reference", "note"]'),
  ('payment.client_reported', 'email', '{{actor}} says they paid {{milestone}}', '{{actor}} reported a payment on {{title}} in the client portal.

Milestone: {{milestone}}
Amount: {{amount}}
Paid on: {{paidOn}}
Reference: {{reference}}
{{note}}

Check it against the bank, then record the receipt or say it wasn''t received.', '["title", "clientName", "actor", "milestone", "amount", "paidOn", "reference", "note"]'),
  ('project.client_issue', 'in_app', '{{actor}} reported an issue on {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('project.client_issue', 'email', '{{actor}} reported an issue on {{title}}', '{{actor}} reported an issue in the client portal:

{{note}}

Triage it: accept it as a snag with a severity, or decline it with a reason the client reads.', '["title", "clientName", "actor", "note"]'),
  ('request.client_raised', 'email', '{{actor}} sent a message on {{title}}', '{{actor}} wrote in the client portal: {{request}}

{{note}}', '["title", "clientName", "actor", "request", "note"]'),
  ('request.client_replied', 'email', '{{actor}} replied on {{title}}', '{{actor}} replied in the client portal on {{request}}:

{{note}}', '["title", "clientName", "actor", "request", "note"]'),
  ('portal.team_replied', 'email', '{{company}} replied on {{project}}', '{{note}}

Open your project page to read it and reply.', '["company", "project", "title", "due", "note"]'),
  ('portal.payment_checked', 'email', 'Your payment on {{project}}', '{{note}}

Open your project page to see your payments.', '["company", "project", "title", "due", "note"]'),
  ('portal.issue_triaged', 'email', 'The issue you reported on {{project}}', '{{note}}

Open your project page to follow it.', '["company", "project", "title", "due", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
