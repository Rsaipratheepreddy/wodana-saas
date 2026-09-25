-- Catalog v2: typed tables for the engine behind quotes, BoM, purchasing and factory (plan §6.4).
-- Catalogs never mix; categories form a tree and carry typed attributes; items have a type and
-- values per attribute; variants are concrete combinations; components (BoM) take quantity
-- formulas; price books hold explainable price entries (typed money columns, never floats).
-- The v1 generic records stay until every consumer has moved, then they are removed.
CREATE TABLE catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code varchar(40) NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]*$'),
  name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
  purpose varchar(16) NOT NULL DEFAULT 'sell' CHECK (purpose IN ('sell', 'buy', 'reference')),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE TABLE catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  parent_id uuid,
  code varchar(60) NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9_-]*$'),
  name varchar(160) NOT NULL CHECK (length(btrim(name)) > 0),
  sort_order integer NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (catalog_id, code),
  FOREIGN KEY (workspace_id, catalog_id) REFERENCES catalogs (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, parent_id) REFERENCES catalog_categories (workspace_id, id) ON DELETE CASCADE,
  CHECK (parent_id IS NULL OR parent_id <> id)
);
--> statement-breakpoint
CREATE TABLE catalog_units (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  code varchar(16) NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label varchar(60) NOT NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('count', 'length', 'area', 'volume', 'weight', 'time')),
  to_base numeric(20, 10) NOT NULL CHECK (to_base > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, code)
);
--> statement-breakpoint
CREATE TABLE catalog_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  category_id uuid,
  code varchar(60) NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  label varchar(120) NOT NULL,
  value_type varchar(16) NOT NULL CHECK (value_type IN ('text', 'number', 'choice', 'multi_choice', 'color', 'boolean', 'dimension')),
  unit_code varchar(16),
  required boolean NOT NULL DEFAULT false,
  choices jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(choices) = 'array'),
  default_value text,
  sort_order integer NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, catalog_id) REFERENCES catalogs (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, category_id) REFERENCES catalog_categories (workspace_id, id) ON DELETE CASCADE,
  CHECK (value_type NOT IN ('choice', 'multi_choice') OR jsonb_array_length(choices) > 0),
  CHECK (value_type <> 'dimension' OR unit_code IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX catalog_attributes_code_uidx ON catalog_attributes (catalog_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
--> statement-breakpoint
CREATE TABLE catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  category_id uuid,
  code varchar(80) NOT NULL CHECK (length(btrim(code)) > 0),
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  item_type varchar(16) NOT NULL CHECK (item_type IN ('product', 'material', 'assembly', 'service', 'package', 'ready_made')),
  unit_code varchar(16) NOT NULL,
  description text,
  waste_percent numeric(7, 4) CHECK (waste_percent IS NULL OR (waste_percent >= 0 AND waste_percent <= 100)),
  purchase_round_to numeric(20, 6) CHECK (purchase_round_to IS NULL OR purchase_round_to > 0),
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (catalog_id, code),
  FOREIGN KEY (workspace_id, catalog_id) REFERENCES catalogs (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, category_id) REFERENCES catalog_categories (workspace_id, id) ON DELETE SET NULL (category_id)
);
--> statement-breakpoint
CREATE INDEX catalog_items_category_idx ON catalog_items (workspace_id, catalog_id, category_id);
--> statement-breakpoint
CREATE INDEX catalog_items_search_idx ON catalog_items USING gin (to_tsvector('simple', coalesce(code, '') || ' ' || name));
--> statement-breakpoint
CREATE TABLE catalog_item_values (
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  attribute_id uuid NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (item_id, attribute_id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, attribute_id) REFERENCES catalog_attributes (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE catalog_item_conversions (
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  from_unit varchar(16) NOT NULL,
  to_unit varchar(16) NOT NULL,
  factor numeric(20, 10) NOT NULL CHECK (factor > 0),
  PRIMARY KEY (item_id, from_unit, to_unit),
  FOREIGN KEY (workspace_id, item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE,
  CHECK (from_unit <> to_unit)
);
--> statement-breakpoint
CREATE TABLE catalog_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  code varchar(80) NOT NULL,
  name varchar(200) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (item_id, code),
  FOREIGN KEY (workspace_id, item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE catalog_variant_values (
  workspace_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  attribute_id uuid NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (variant_id, attribute_id),
  FOREIGN KEY (workspace_id, variant_id) REFERENCES catalog_variants (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, attribute_id) REFERENCES catalog_attributes (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE catalog_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  parent_item_id uuid NOT NULL,
  component_item_id uuid NOT NULL,
  component_variant_id uuid,
  quantity_formula varchar(500) NOT NULL CHECK (length(btrim(quantity_formula)) > 0),
  unit_code varchar(16) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, parent_item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, component_item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, component_variant_id) REFERENCES catalog_variants (workspace_id, id) ON DELETE RESTRICT,
  CHECK (parent_item_id <> component_item_id)
);
--> statement-breakpoint
CREATE TABLE catalog_supplier_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  variant_id uuid,
  vendor_id uuid NOT NULL,
  vendor_sku varchar(120),
  cost numeric(18, 6) CHECK (cost IS NULL OR cost >= 0),
  currency char(3),
  pack_size numeric(20, 6) CHECK (pack_size IS NULL OR pack_size > 0),
  minimum_order numeric(20, 6) CHECK (minimum_order IS NULL OR minimum_order > 0),
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  preferred boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, variant_id) REFERENCES catalog_variants (workspace_id, id) ON DELETE CASCADE,
  CHECK (cost IS NULL OR currency IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE price_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  catalog_id uuid NOT NULL,
  name varchar(160) NOT NULL,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  legal_entity_id uuid,
  segment varchar(60),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'expired')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, catalog_id) REFERENCES catalogs (workspace_id, id) ON DELETE CASCADE,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
--> statement-breakpoint
CREATE TABLE price_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  price_book_id uuid NOT NULL,
  item_id uuid NOT NULL,
  variant_id uuid,
  method varchar(24) NOT NULL CHECK (method IN ('fixed', 'cost_plus', 'per_measure', 'tiered', 'attribute_surcharge', 'assembly_rollup')),
  price numeric(18, 6), cost numeric(18, 6), markup_percent numeric(9, 4), rate numeric(18, 6),
  minimum_charge numeric(18, 6), labour numeric(18, 6), margin_percent numeric(9, 4),
  status varchar(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'active', 'expired')),
  reviewed_by uuid, reviewed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, price_book_id) REFERENCES price_books (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, variant_id) REFERENCES catalog_variants (workspace_id, id) ON DELETE CASCADE,
  CHECK (method <> 'fixed' OR price IS NOT NULL),
  CHECK (method <> 'cost_plus' OR (cost IS NOT NULL AND markup_percent IS NOT NULL)),
  CHECK (method <> 'per_measure' OR rate IS NOT NULL),
  CHECK (method <> 'attribute_surcharge' OR price IS NOT NULL),
  CHECK (coalesce(price, 0) >= 0 AND coalesce(cost, 0) >= 0 AND coalesce(rate, 0) >= 0 AND coalesce(minimum_charge, 0) >= 0 AND coalesce(labour, 0) >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX price_entries_current_uidx ON price_entries (price_book_id, item_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status <> 'expired';
--> statement-breakpoint
CREATE TABLE price_entry_tiers (
  workspace_id uuid NOT NULL,
  price_entry_id uuid NOT NULL,
  from_quantity numeric(20, 6) NOT NULL CHECK (from_quantity > 0),
  price numeric(18, 6) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (price_entry_id, from_quantity),
  FOREIGN KEY (workspace_id, price_entry_id) REFERENCES price_entries (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE price_entry_surcharges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  price_entry_id uuid NOT NULL,
  attribute_id uuid NOT NULL,
  value text NOT NULL,
  percent numeric(9, 4),
  amount numeric(18, 6),
  label varchar(120),
  FOREIGN KEY (workspace_id, price_entry_id) REFERENCES price_entries (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, attribute_id) REFERENCES catalog_attributes (workspace_id, id) ON DELETE CASCADE,
  CHECK ((percent IS NULL) <> (amount IS NULL))
);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['catalogs', 'catalog_categories', 'catalog_units', 'catalog_attributes', 'catalog_items',
    'catalog_item_values', 'catalog_item_conversions', 'catalog_variants', 'catalog_variant_values', 'catalog_components',
    'catalog_supplier_links', 'price_books', 'price_entries', 'price_entry_tiers', 'price_entry_surcharges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- The vendor on a supplier link belongs to the same workspace (composite key).
ALTER TABLE catalog_supplier_links ADD CONSTRAINT catalog_supplier_links_vendor_fk
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE TRIGGER price_books_legal_entity_workspace BEFORE INSERT OR UPDATE ON price_books
  FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('legal_entities', 'legal_entity_id');
