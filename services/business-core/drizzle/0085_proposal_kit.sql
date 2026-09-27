-- The firm's proposal kit: the words, contact block and optional pictures its client proposals are
-- built from. One per workspace; every field is optional, and anything left empty falls back to the
-- tenant brand (name, logo, brand colour) or the page leaves it out. Layout, type and page colours
-- are Wodana's and deliberately not configurable; pictures go into fixed slots. Pictures are small
-- data-URI images (validated in the service), the same form the proposal designer already stores.
CREATE TABLE workspace_proposal_kits (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  introduction text NOT NULL DEFAULT '',
  letter_note text NOT NULL DEFAULT '',
  default_terms text NOT NULL DEFAULT '',
  default_exclusions text NOT NULL DEFAULT '',
  contact_details text NOT NULL DEFAULT '',
  website varchar(200) NOT NULL DEFAULT '',
  introduction_image text,
  closing_image text,
  monogram_image text,
  terms_images text[] NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_proposal_kits_terms_images CHECK (cardinality(terms_images) <= 3)
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE workspace_proposal_kits ENABLE ROW LEVEL SECURITY;
  ALTER TABLE workspace_proposal_kits FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON workspace_proposal_kits
    USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
    WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON workspace_proposal_kits TO wodana_app;
  END IF;
END $$;
