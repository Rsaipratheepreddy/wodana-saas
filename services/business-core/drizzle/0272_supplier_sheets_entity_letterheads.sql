-- PLM-111 supplier lists as linked sheets, and PLM-112 entity letterheads.
--   * A supplier list kept in a spreadsheet is a third linked-import target. A link can be one company's list:
--     its suppliers are recorded as selling to that company.
--   * supplier_attributes: a supplier list's extra columns, kept with the supplier by their heading.
--   * Each legal entity (business) carries what its documents print: phone, email, a logo, and a letterhead
--     (a header image and footer text). Images live with the workspace's brand assets, marked with what they're
--     for and whose they are, so an entity's logo never replaces the workspace logo.
ALTER TABLE import_links ALTER COLUMN target TYPE varchar(12);
--> statement-breakpoint
ALTER TABLE import_links DROP CONSTRAINT import_links_target_check;
--> statement-breakpoint
ALTER TABLE import_links ADD CONSTRAINT import_links_target_check CHECK (target IN ('stock', 'catalog', 'suppliers'));
--> statement-breakpoint
ALTER TABLE import_links ADD COLUMN legal_entity_id uuid;
--> statement-breakpoint
ALTER TABLE import_links ADD CONSTRAINT import_links_legal_entity_fk FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id);
--> statement-breakpoint
ALTER TABLE import_links ADD CONSTRAINT import_links_legal_entity_check CHECK (target = 'suppliers' OR legal_entity_id IS NULL);
--> statement-breakpoint
CREATE TABLE supplier_attributes (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  vendor_id uuid NOT NULL,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  value varchar(1000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX supplier_attributes_name_key ON supplier_attributes (workspace_id, vendor_id, lower(name));
--> statement-breakpoint
ALTER TABLE supplier_attributes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE supplier_attributes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON supplier_attributes
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE workspace_brand_assets ADD COLUMN purpose varchar(20) NOT NULL DEFAULT 'workspace_logo'
  CHECK (purpose IN ('workspace_logo', 'entity_logo', 'entity_letterhead'));
--> statement-breakpoint
ALTER TABLE workspace_brand_assets ADD COLUMN legal_entity_id uuid;
--> statement-breakpoint
ALTER TABLE workspace_brand_assets ADD CONSTRAINT workspace_brand_assets_entity_fk FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id);
--> statement-breakpoint
ALTER TABLE workspace_brand_assets ADD CONSTRAINT workspace_brand_assets_entity_check CHECK ((purpose = 'workspace_logo') = (legal_entity_id IS NULL));
--> statement-breakpoint
ALTER TABLE legal_entities
  ADD COLUMN phone varchar(40),
  ADD COLUMN email varchar(320),
  ADD COLUMN logo_asset_id uuid REFERENCES workspace_brand_assets (id),
  ADD COLUMN letterhead_asset_id uuid REFERENCES workspace_brand_assets (id),
  ADD COLUMN letterhead_footer varchar(1000);
--> statement-breakpoint
CREATE TRIGGER legal_entities_logo_asset_workspace_guard BEFORE INSERT OR UPDATE ON legal_entities
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_brand_assets', 'logo_asset_id');
--> statement-breakpoint
CREATE TRIGGER legal_entities_letterhead_asset_workspace_guard BEFORE INSERT OR UPDATE ON legal_entities
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_brand_assets', 'letterhead_asset_id');
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON supplier_attributes TO wodana_app;
  END IF;
END $$;
