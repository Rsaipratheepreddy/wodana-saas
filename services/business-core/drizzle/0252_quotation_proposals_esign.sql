-- P3 quotation side (plan §6.9a): quotation numbering with a suffix, external quotations as document cards,
-- the firm's five-page proposal template, native e-sign (R8), markup disclosure (R3), the QS hand-off
-- (PLM-082/084) and the intro deck link (PLM-106). Tables hold the truth; money stays numeric; every table is
-- tenant-isolated with forced RLS.

-- 1. Numbering: a suffix after the number ("QUO-2026-00012-PL"). The allocator stays the single, row-locked,
--    gap-free source of numbers; no caller ever computes max()+1.
ALTER TABLE document_sequences ADD COLUMN suffix varchar(40) NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION allocate_document_number(p_workspace_id uuid, p_entity_id uuid, p_document_type text, p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  sequence_row document_sequences%ROWTYPE;
  entity_zone text;
  period integer;
  allocated integer;
BEGIN
  SELECT timezone INTO entity_zone FROM legal_entities WHERE workspace_id = p_workspace_id AND id = p_entity_id;
  IF entity_zone IS NULL THEN RAISE EXCEPTION 'legal entity % not found', p_entity_id USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO sequence_row FROM document_sequences
    WHERE workspace_id = p_workspace_id AND legal_entity_id = p_entity_id AND document_type = p_document_type
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no % numbering for legal entity %', p_document_type, p_entity_id USING ERRCODE = 'no_data_found'; END IF;
  period := extract(year FROM p_at AT TIME ZONE entity_zone)::integer;
  allocated := sequence_row.next_number;
  IF sequence_row.reset_policy = 'annual' AND sequence_row.current_period IS NOT NULL AND sequence_row.current_period <> period THEN
    allocated := 1;
  END IF;
  UPDATE document_sequences SET next_number = allocated + 1, current_period = period, version = version + 1
    WHERE id = sequence_row.id;
  RETURN replace(sequence_row.prefix, '{YYYY}', period::text)
    || lpad(allocated::text, greatest(sequence_row.padding, length(allocated::text)), '0')
    || replace(sequence_row.suffix, '{YYYY}', period::text);
END;
$$;
--> statement-breakpoint
-- 2. Quotation settings: how markup is shown to the client (R3), whether QS confirms pricing before sending
--    (PLM-082), how long a signing link stays open, and the firm's intro deck (PLM-106).
ALTER TABLE workspace_quotation_settings
  ADD COLUMN markup_disclosure varchar(20) NOT NULL DEFAULT 'all_inclusive'
    CHECK (markup_disclosure IN ('all_inclusive', 'disclosed_markup', 'fee_based')),
  ADD COLUMN qs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN signing_link_days smallint NOT NULL DEFAULT 14 CHECK (signing_link_days BETWEEN 1 AND 90),
  ADD COLUMN intro_deck_url varchar(1000) CHECK (intro_deck_url IS NULL OR intro_deck_url ~ '^https://');
--> statement-breakpoint
-- 3. The quotation number of a quote family (every revision shows it): allocated from the entity's sequence
--    on first sending, or the firm's own number on an uploaded external quotation.
CREATE TABLE quotation_references (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  family_id text NOT NULL,
  legal_entity_id uuid,
  reference varchar(120) NOT NULL CHECK (btrim(reference) <> ''),
  source varchar(12) NOT NULL CHECK (source IN ('allocated', 'external')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, case_id, family_id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  CHECK (source = 'external' OR legal_entity_id IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX quotation_references_number_uidx ON quotation_references (workspace_id, lower(reference));
--> statement-breakpoint
-- What the client was shown when a quote went out: its number and the markup disclosure in force then.
CREATE TABLE quote_issue_snapshots (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  reference varchar(120),
  markup_disclosure varchar(20) NOT NULL CHECK (markup_disclosure IN ('all_inclusive', 'disclosed_markup', 'fee_based')),
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, case_id, quote_id),
  FOREIGN KEY (workspace_id, case_id, quote_id) REFERENCES commercial_quotes (workspace_id, case_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- 4. Quotation documents: a card (proposal PDF, external quotation) with immutable versions as its history.
CREATE TABLE quote_documents (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text,
  kind varchar(24) NOT NULL CHECK (kind IN ('proposal', 'external_quotation')),
  title varchar(240) NOT NULL,
  reference varchar(120),
  amount numeric(18, 4) CHECK (amount IS NULL OR amount >= 0),
  currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  current_version integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  CHECK ((amount IS NULL) = (currency IS NULL))
);
--> statement-breakpoint
CREATE INDEX quote_documents_case_idx ON quote_documents (workspace_id, case_id, created_at);
--> statement-breakpoint
-- An external quotation keeps the firm's own number, once per workspace.
CREATE UNIQUE INDEX quote_documents_external_reference_uidx ON quote_documents (workspace_id, lower(reference)) WHERE kind = 'external_quotation';
--> statement-breakpoint
CREATE TABLE quote_document_versions (
  workspace_id uuid NOT NULL,
  document_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  purpose varchar(12) NOT NULL CHECK (purpose IN ('upload', 'issued', 'signed')),
  object_key text NOT NULL,
  file_name varchar(240) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 41943040),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  quote_hash text,
  template_version integer,
  note varchar(1000) NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, document_id, number),
  FOREIGN KEY (workspace_id, document_id) REFERENCES quote_documents (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
-- 5. The firm's proposal template: pages 1–3 and 5 are its own designed pages; page 4 is always the live
--    quotation. Every change makes a new template version; issued proposals keep the version they used.
CREATE TABLE proposal_templates (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE proposal_template_pages (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  template_version integer NOT NULL CHECK (template_version > 0),
  slot smallint NOT NULL CHECK (slot IN (1, 2, 3, 5)),
  object_key text NOT NULL,
  file_name varchar(240) NOT NULL,
  mime_type varchar(100) NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  byte_size integer NOT NULL CHECK (byte_size > 0 AND byte_size <= 20971520),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  page_count smallint NOT NULL CHECK (page_count BETWEEN 1 AND 20),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, template_version, slot)
);
--> statement-breakpoint
-- 6. Native e-sign (R8): a signing link sent to a named signer for one exact PDF (its SHA-256). The token is
--    stored only as a hash. Signing records identity, time, IP, user agent and the signature, and stores the
--    signed PDF (with its certificate page) as a new immutable document version.
CREATE TABLE esign_requests (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  subject_kind varchar(24) NOT NULL CHECK (subject_kind IN ('quote_proposal', 'change_request')),
  case_id uuid NOT NULL,
  quote_id text,
  quote_hash text,
  grant_id uuid,
  document_id uuid NOT NULL,
  document_version integer NOT NULL,
  document_sha256 char(64) NOT NULL CHECK (document_sha256 ~ '^[0-9a-f]{64}$'),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  signer_name varchar(160) NOT NULL,
  signer_email varchar(254),
  signer_phone varchar(32),
  status varchar(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  signed_at timestamptz,
  signed_name varchar(160),
  signed_email varchar(254),
  signed_phone varchar(32),
  signature_kind varchar(8) CHECK (signature_kind IN ('typed', 'drawn')),
  signature_text varchar(160),
  signature_sha256 char(64),
  signer_ip varchar(64),
  signer_user_agent varchar(500),
  signed_document_version integer,
  signed_sha256 char(64),
  revoked_at timestamptz,
  revoked_by uuid,
  -- The staff command that created the link, so a retried send returns the same request.
  command_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, document_id) REFERENCES quote_documents (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  CHECK (status <> 'signed' OR (signed_at IS NOT NULL AND signature_kind IS NOT NULL AND signed_sha256 IS NOT NULL AND signer_ip IS NOT NULL)),
  CHECK (signer_email IS NOT NULL OR signer_phone IS NOT NULL)
);
--> statement-breakpoint
-- One open link per document version: sending again revokes the previous one.
CREATE UNIQUE INDEX esign_requests_open_uidx ON esign_requests (workspace_id, document_id, document_version) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX esign_requests_case_idx ON esign_requests (workspace_id, case_id, created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX esign_requests_command_uidx ON esign_requests (workspace_id, command_id);
--> statement-breakpoint
-- 7. QS hand-off (PLM-082/084): Sales admin hands a quotation to a named QS ("With QS"); the QS prices it and
--    confirms (who and when, through the approval engine); sending to the client waits for a confirmation that
--    still matches the quote's pricing.
CREATE TABLE quote_qs_reviews (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  assignee_user_id uuid NOT NULL,
  status varchar(12) NOT NULL CHECK (status IN ('with_qs', 'confirmed', 'returned')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  note varchar(2000) NOT NULL DEFAULT '',
  pricing_hash char(64) CHECK (pricing_hash IS NULL OR pricing_hash ~ '^[0-9a-f]{64}$'),
  decided_by uuid,
  decided_at timestamptz,
  decision_note varchar(2000) NOT NULL DEFAULT '',
  approval_id uuid,
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id, quote_id) REFERENCES commercial_quotes (workspace_id, case_id, id) ON DELETE CASCADE,
  CHECK (status = 'with_qs' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'confirmed' OR pricing_hash IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX quote_qs_reviews_open_uidx ON quote_qs_reviews (workspace_id, case_id, quote_id) WHERE status = 'with_qs';
--> statement-breakpoint
CREATE INDEX quote_qs_reviews_assignee_idx ON quote_qs_reviews (workspace_id, assignee_user_id) WHERE status = 'with_qs';
--> statement-breakpoint
-- Signed and issued files never change: a version row can't be updated, and only goes with its case.
CREATE FUNCTION guard_quote_document_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'document versions are immutable' USING ERRCODE = 'check_violation', CONSTRAINT = 'quote_document_version_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER quote_document_versions_immutable BEFORE UPDATE ON quote_document_versions
  FOR EACH ROW EXECUTE FUNCTION guard_quote_document_version();
--> statement-breakpoint
CREATE TRIGGER proposal_template_pages_immutable BEFORE UPDATE ON proposal_template_pages
  FOR EACH ROW EXECUTE FUNCTION guard_quote_document_version();
--> statement-breakpoint
-- A signed request keeps its evidence: once signed, nothing about it changes.
CREATE FUNCTION guard_signed_esign_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    RAISE EXCEPTION 'a signed request is final' USING ERRCODE = 'check_violation', CONSTRAINT = 'esign_request_signed_final';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER esign_requests_signed_final BEFORE UPDATE ON esign_requests
  FOR EACH ROW EXECUTE FUNCTION guard_signed_esign_request();
--> statement-breakpoint
-- The signing page has no session: it finds the workspace of a link from the token's hash only.
CREATE FUNCTION esign_request_workspace(p_token_hash varchar)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT request.workspace_id FROM public.esign_requests request
    JOIN public.workspaces workspace ON workspace.id = request.workspace_id AND workspace.status = 'active'
   WHERE request.token_hash = p_token_hash;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION esign_request_workspace(varchar) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['quotation_references', 'quote_issue_snapshots', 'quote_documents', 'quote_document_versions',
    'proposal_templates', 'proposal_template_pages', 'esign_requests', 'quote_qs_reviews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON quotation_references, quote_issue_snapshots, quote_documents, proposal_templates, esign_requests, quote_qs_reviews TO wodana_app;
    GRANT SELECT, INSERT ON quote_document_versions, proposal_template_pages TO wodana_app;
    GRANT EXECUTE ON FUNCTION esign_request_workspace(varchar) TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Notices of the QS hand-off, for every workspace (new workspaces get them from the default templates).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('quotation.with_qs', 'in_app', 'To price · {{title}}', '{{actor}} sent it to you for pricing ({{clientName}}). {{note}}', '["title","clientName","actor","note"]'),
  ('quotation.with_qs', 'email', 'Please price {{title}} · {{clientName}}', E'{{actor}} sent {{title}} for {{clientName}} to you for pricing.\n\n{{note}}\n\nOpen it to price the lines and confirm.', '["title","clientName","actor","note"]'),
  ('quotation.qs_confirmed', 'in_app', 'Priced: {{title}}', '{{actor}} confirmed the pricing. It can go to {{clientName}}.', '["title","clientName","actor","note"]'),
  ('quotation.qs_confirmed', 'email', '{{title}} is priced · {{clientName}}', E'{{actor}} confirmed the pricing of {{title}} ({{clientName}}).\n\nOpen it to add it to the proposal and send it to the client.', '["title","clientName","actor","note"]'),
  ('quotation.qs_returned', 'in_app', 'QS returned {{title}}', '{{actor}}: {{note}}', '["title","clientName","actor","note"]')
) AS template(code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
