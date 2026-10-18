-- PLM-157: the Material Coordinator's sample library and access.
--
-- 1. sample_price_bands: the firm's price ranges a sample is tagged with (configuration). Amounts are numeric in the
--    workspace's currency (its region); a band may leave either end open, or name a range without amounts.
-- 2. material_samples: the physical samples the firm holds (own stock first, then brands), each tagged with a price
--    band, a finish category, where it is kept, its supplier or brand, the catalog item it stands for, and a photo.
--    Searchable when choosing materials. Archived, never deleted (choices made from it keep pointing at it).
-- 3. Two permissions, given one by one: pre_projects.manage_materials (keep a case's material log and samples without
--    editing the rest of the case) and catalog.samples.manage (keep the sample library). Owners and administrators
--    hold both, like every permission.
-- Workspace-scoped, forced RLS, tenant_isolation. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS sample_price_bands (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  label varchar(80) NOT NULL CHECK (length(btrim(label)) > 0),
  min_amount numeric(14, 2) CHECK (min_amount IS NULL OR min_amount >= 0),
  max_amount numeric(14, 2) CHECK (max_amount IS NULL OR max_amount >= 0),
  position integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CHECK (min_amount IS NULL OR max_amount IS NULL OR max_amount >= min_amount)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sample_price_bands_label_idx ON sample_price_bands (workspace_id, lower(label)) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS material_samples (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name varchar(240) NOT NULL CHECK (length(btrim(name)) > 0),
  code varchar(80) NOT NULL DEFAULT '',
  category_key varchar(40) CHECK (category_key IS NULL OR category_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  origin varchar(20) NOT NULL DEFAULT 'own_stock' CHECK (origin IN ('own_stock', 'brand', 'local_supplier')),
  supplier varchar(200) NOT NULL DEFAULT '',
  catalog_item_id uuid REFERENCES catalog_items (id) ON DELETE SET NULL,
  price_band_id uuid,
  location varchar(200) NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  in_stock boolean NOT NULL DEFAULT true,
  photo_name varchar(240),
  photo_mime varchar(100),
  photo_key varchar(500),
  photo_preview_key varchar(500),
  photo_sha256 char(64),
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, price_band_id) REFERENCES sample_price_bands (workspace_id, id),
  CHECK ((photo_key IS NULL) = (photo_mime IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS material_samples_search_idx ON material_samples (workspace_id, lower(name)) WHERE archived_at IS NULL;
--> statement-breakpoint
-- A choice made from a library sample points at it (archived samples stay readable).
DO $$
BEGIN
  ALTER TABLE design_ledger_versions ADD CONSTRAINT design_ledger_versions_sample_fk FOREIGN KEY (workspace_id, sample_id) REFERENCES material_samples (workspace_id, id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['sample_price_bands', 'material_samples'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON sample_price_bands, material_samples TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('sample_price_bands', 'keep', NULL, '{}'),
  ('material_samples', 'clear', NULL, ARRAY['photo_key', 'photo_preview_key'])
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('pre_projects.manage_materials', 'Keep the material log and the samples on cases'),
  ('catalog.samples.manage', 'Keep the sample library')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- Owners and administrators hold both, like every permission; teams get them one by one (Palm: the Material Coordinator).
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('pre_projects.manage_materials', 'catalog.samples.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
