-- Product sourcing (plan §6.7a batch 3; §0.7 R4 product clipper, R5 fit check; §6.25 Canva link cards; E5-6).
--   * product_clips: a supplier page read for the catalog (source URL, what the page said as an immutable payload
--     snapshot, the AI model when one filled gaps). A person reviews it and saves it as a catalog item.
--   * product_clip_fields: one row per proposed field with its source (structured data, OpenGraph, page text, AI or
--     the person), confidence, evidence, and who confirmed it and how (§0.7 C3 AI provenance).
--   * product_clip_images: pictures copied from the page into our storage (never hotlinked).
--   * catalog_item_dimensions: an item's outside size W × D × H (plus a maker's diagonal depth) in its own unit.
--   * catalog_supplier_links.product_url: the supplier's product page kept on the link.
--   * site_access_points: the measured way in on a case's site (doors, lifts, stairs, corridors, windows), by route.
--   * fit_check_overrides: a failed fit check let through with a reason, for exactly the inputs it saw.
--   * link_previews: link cards (Canva designs and other links) with their stored thumbnail.
-- Every table has workspace_id, forced RLS and the tenant_isolation policy. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS product_clips (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  catalog_id uuid NOT NULL,
  source_url varchar(2000) NOT NULL CHECK (source_url ~ '^https?://'),
  final_url varchar(2000) NOT NULL CHECK (final_url ~ '^https?://'),
  host varchar(255) NOT NULL,
  page_title varchar(300),
  page_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_status varchar(12) NOT NULL CHECK (ai_status IN ('used', 'not_needed', 'off', 'failed')),
  ai_model varchar(120),
  status varchar(12) NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'saved', 'discarded')),
  catalog_item_id uuid,
  saved_by uuid,
  saved_at timestamptz,
  fetched_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, catalog_id) REFERENCES catalogs (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, catalog_item_id) REFERENCES catalog_items (workspace_id, id),
  CHECK (ai_status <> 'used' OR ai_model IS NOT NULL),
  CHECK (status <> 'saved' OR (catalog_item_id IS NOT NULL AND saved_by IS NOT NULL AND saved_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_clips_item_idx ON product_clips (workspace_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS product_clip_fields (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  clip_id uuid NOT NULL,
  field varchar(20) NOT NULL CHECK (field IN ('name', 'brand', 'sku', 'description', 'price', 'currency', 'width', 'depth', 'height', 'diagonal_depth',
    'dimension_unit', 'finish', 'material', 'colour', 'lead_time_days')),
  proposed_value varchar(4000),
  source varchar(16) NOT NULL CHECK (source IN ('structured_data', 'open_graph', 'page_text', 'ai', 'person')),
  confidence numeric(3, 2) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence varchar(500),
  model varchar(120),
  decision varchar(10) NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending', 'accepted', 'edited', 'rejected', 'added')),
  final_value varchar(4000),
  confirmed_by uuid,
  confirmed_at timestamptz,
  PRIMARY KEY (workspace_id, clip_id, field),
  FOREIGN KEY (workspace_id, clip_id) REFERENCES product_clips (workspace_id, id) ON DELETE CASCADE,
  CHECK (source <> 'ai' OR (model IS NOT NULL AND confidence IS NOT NULL)),
  CHECK ((source = 'person') = (proposed_value IS NULL)),
  CHECK (decision = 'pending' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS product_clip_images (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  clip_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  source_url varchar(2000) NOT NULL CHECK (source_url ~ '^https?://'),
  object_key varchar(500) NOT NULL,
  preview_key varchar(500),
  mime_type varchar(80) NOT NULL CHECK (mime_type LIKE 'image/%'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, clip_id, position),
  FOREIGN KEY (workspace_id, clip_id) REFERENCES product_clips (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS catalog_item_dimensions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  width numeric(12, 2) CHECK (width IS NULL OR width > 0),
  depth numeric(12, 2) CHECK (depth IS NULL OR depth > 0),
  height numeric(12, 2) CHECK (height IS NULL OR height > 0),
  diagonal_depth numeric(12, 2) CHECK (diagonal_depth IS NULL OR diagonal_depth > 0),
  unit varchar(4) NOT NULL CHECK (unit IN ('mm', 'cm', 'm', 'in', 'ft')),
  source varchar(8) NOT NULL CHECK (source IN ('person', 'clipper')),
  clip_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, item_id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, clip_id) REFERENCES product_clips (workspace_id, id)
);
--> statement-breakpoint
ALTER TABLE catalog_supplier_links ADD COLUMN IF NOT EXISTS product_url varchar(2000);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_supplier_links_product_url_check') THEN
    ALTER TABLE catalog_supplier_links ADD CONSTRAINT catalog_supplier_links_product_url_check CHECK (product_url IS NULL OR product_url ~ '^https?://');
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS site_access_points (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  -- Points on one route are passed one after another; an item needs one route it gets all the way through.
  route varchar(60) NOT NULL DEFAULT 'Main' CHECK (length(trim(route)) > 0),
  position integer NOT NULL DEFAULT 0,
  kind varchar(10) NOT NULL CHECK (kind IN ('door', 'lift', 'stair', 'corridor', 'window', 'other')),
  label varchar(120) NOT NULL CHECK (length(trim(label)) > 0),
  width numeric(10, 2) CHECK (width IS NULL OR width > 0),
  height numeric(10, 2) CHECK (height IS NULL OR height > 0),
  -- The clear width of the passage after a 90° turn (a corridor corner or a stair landing).
  turn_width numeric(10, 2) CHECK (turn_width IS NULL OR turn_width > 0),
  cabin_width numeric(10, 2) CHECK (cabin_width IS NULL OR cabin_width > 0),
  cabin_depth numeric(10, 2) CHECK (cabin_depth IS NULL OR cabin_depth > 0),
  cabin_height numeric(10, 2) CHECK (cabin_height IS NULL OR cabin_height > 0),
  unit varchar(4) NOT NULL CHECK (unit IN ('mm', 'cm', 'm', 'in', 'ft')),
  -- The site-visit measurement it was taken from, when there is one.
  site_record_id uuid,
  note varchar(500) NOT NULL DEFAULT '',
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  CHECK (kind = 'lift' OR (cabin_width IS NULL AND cabin_depth IS NULL AND cabin_height IS NULL)),
  CHECK (kind IN ('corridor', 'stair') OR turn_width IS NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS site_access_points_case_idx ON site_access_points (workspace_id, case_id, route, position) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS fit_check_overrides (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL,
  item_id uuid NOT NULL,
  -- The item's size and the access points the check saw; any later change needs a new decision.
  inputs_hash char(64) NOT NULL,
  outcome varchar(14) NOT NULL CHECK (outcome = 'does_not_fit'),
  result jsonb NOT NULL,
  reason varchar(500) NOT NULL CHECK (length(trim(reason)) >= 3),
  context varchar(10) NOT NULL CHECK (context IN ('approval', 'ordering')),
  overridden_by uuid NOT NULL,
  overridden_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, case_id, item_id, inputs_hash),
  FOREIGN KEY (workspace_id, case_id) REFERENCES pre_project_cases (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS link_previews (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  url varchar(2000) NOT NULL CHECK (url ~ '^https://'),
  url_hash char(64) NOT NULL,
  provider varchar(8) NOT NULL CHECK (provider IN ('canva', 'web')),
  title varchar(300),
  image_key varchar(500),
  image_preview_key varchar(500),
  image_mime varchar(80) CHECK (image_mime IS NULL OR image_mime LIKE 'image/%'),
  status varchar(12) NOT NULL CHECK (status IN ('ok', 'unavailable')),
  fetched_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, url_hash)
);
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['product_clips', 'product_clip_fields', 'product_clip_images', 'catalog_item_dimensions', 'site_access_points', 'fit_check_overrides', 'link_previews'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON product_clips TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON product_clip_fields TO wodana_app;
    GRANT SELECT, INSERT ON product_clip_images TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON catalog_item_dimensions TO wodana_app;
    -- Access points are archived, never deleted; overrides are history.
    GRANT SELECT, INSERT, UPDATE ON site_access_points TO wodana_app;
    GRANT SELECT, INSERT ON fit_check_overrides TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON link_previews TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('sourcing.fit_override', 'in_app', 'Fit check overridden · {{item}}', '{{actor}} let {{item}} through for {{clientName}}: {{reason}}', '["item","clientName","actor","reason"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
