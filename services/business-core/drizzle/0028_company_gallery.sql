-- Company gallery: a branded, shareable brochure of the firm's services, products, recent projects
-- and client feedback. Visitors add items to a list and send it through the firm's own enquiry form.
-- Everything is edited by the firm; only a published gallery is visible by its link.
CREATE TABLE workspace_galleries (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  slug varchar(60) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  style varchar(16) NOT NULL DEFAULT 'atelier',
  accent varchar(7) CHECK (accent IS NULL OR accent ~ '^#[0-9a-fA-F]{6}$'),
  headline varchar(200) NOT NULL DEFAULT '',
  intro text NOT NULL DEFAULT '',
  about text NOT NULL DEFAULT '',
  hero_image_id uuid,
  contact_phone varchar(40) NOT NULL DEFAULT '',
  contact_email varchar(200) NOT NULL DEFAULT '',
  contact_whatsapp varchar(40) NOT NULL DEFAULT '',
  contact_address varchar(400) NOT NULL DEFAULT '',
  lead_form_id uuid,
  enquiry_source varchar(80),
  enquiry_channel varchar(80),
  show_prices boolean NOT NULL DEFAULT false,
  -- What visitors see (configuration): descriptions, "My list" and enquiries, search, filter chips, contact buttons.
  display jsonb NOT NULL DEFAULT '{"descriptions":true,"list":true,"search":true,"chips":true,"contact":true}'::jsonb,
  -- Section order and visibility (configuration): services, products, projects, testimonials, about, contact.
  sections jsonb NOT NULL DEFAULT '[{"key":"services","visible":true},{"key":"products","visible":true},{"key":"projects","visible":true},{"key":"testimonials","visible":true},{"key":"about","visible":true},{"key":"contact","visible":true}]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  published_at timestamptz,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE workspace_gallery_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  kind varchar(12) NOT NULL CHECK (kind IN ('service', 'product', 'project', 'testimonial')),
  title varchar(200) NOT NULL CHECK (length(btrim(title)) > 0),
  subtitle varchar(300) NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  price_from numeric(18, 2) CHECK (price_from IS NULL OR price_from >= 0),
  price_unit varchar(40) NOT NULL DEFAULT '',
  catalog_item_id uuid,
  rating smallint CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  position integer NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, catalog_item_id) REFERENCES catalog_items (workspace_id, id) ON DELETE SET NULL (catalog_item_id)
);
--> statement-breakpoint
CREATE INDEX workspace_gallery_items_kind_idx ON workspace_gallery_items (workspace_id, kind, position);
--> statement-breakpoint
CREATE TABLE workspace_gallery_images (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  item_id uuid,
  original_name varchar(240) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key text NOT NULL,
  preview_key text,
  sha256 char(64) NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES workspace_gallery_items (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX workspace_gallery_images_item_idx ON workspace_gallery_images (workspace_id, item_id, sort_order);
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['workspace_galleries', 'workspace_gallery_items', 'workspace_gallery_images'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_galleries, workspace_gallery_items, workspace_gallery_images TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The public page finds its workspace by the gallery link, only while published. Each request then
-- runs in that workspace's tenant transaction.
CREATE FUNCTION public_gallery_workspace(p_slug text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT workspace_id FROM workspace_galleries WHERE slug = lower(p_slug) AND status = 'published';
$$;
--> statement-breakpoint
-- A slug is free when no other workspace uses it (checked across tenants).
CREATE FUNCTION gallery_slug_taken(p_slug text, p_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM workspace_galleries WHERE slug = lower(p_slug) AND workspace_id <> p_workspace_id);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public_gallery_workspace(text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION gallery_slug_taken(text, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION public_gallery_workspace(text) TO wodana_app;
    GRANT EXECUTE ON FUNCTION gallery_slug_taken(text, uuid) TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Gallery notifications: a gallery enquiry arrives through the normal enquiry intake (assignment
-- notifications); the team is told the gallery was published.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'gallery.published', 'in_app', 'en', 1, 'approved', 'Your gallery is live', '{{actor}} published the company gallery.', '["actor"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
-- The client portal links to the firm's gallery while it's published.
CREATE FUNCTION published_gallery_slug(p_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT slug FROM workspace_galleries WHERE workspace_id = p_workspace_id AND status = 'published';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION published_gallery_slug(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION published_gallery_slug(uuid) TO wodana_app;
  END IF;
END $$;
