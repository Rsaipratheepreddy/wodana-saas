ALTER TABLE workspace_catalog_records
  ADD CONSTRAINT workspace_catalog_commerce_check CHECK (
    NOT (content ? 'commerce') OR (
      jsonb_typeof(content->'commerce')='object'
      AND content->'commerce'->>'pricingMode' IN ('unpriced','fixed','on_request')
    )
  ),
  ADD CONSTRAINT workspace_catalog_provenance_check CHECK (
    NOT (content ? 'provenance') OR (
      jsonb_typeof(content->'provenance')='object'
      AND content->'provenance'->>'namespace' ~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
      AND length(btrim(content->'provenance'->>'sourceKey')) BETWEEN 1 AND 300
      AND content->'provenance'->>'sourceFingerprint' ~ '^[0-9a-f]{64}$'
      AND content->'provenance'->>'reviewStatus' IN ('needs_review','approved','rejected')
    )
  );

CREATE UNIQUE INDEX workspace_catalog_provenance_uidx
  ON workspace_catalog_records(
    workspace_id,
    catalog_id,
    (content->'provenance'->>'namespace'),
    (content->'provenance'->>'sourceKey')
  )
  WHERE catalog_id IS NOT NULL AND content ? 'provenance';

CREATE TABLE workspace_catalog_assets (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  catalog_record_id uuid NOT NULL,
  role varchar(24) NOT NULL,
  original_name varchar(240) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL,
  object_key text NOT NULL,
  preview_key text,
  sha256 char(64) NOT NULL,
  alt_text varchar(300),
  sort_order integer NOT NULL DEFAULT 0,
  status varchar(16) NOT NULL DEFAULT 'active',
  archived_reason varchar(500),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_catalog_assets_pk PRIMARY KEY(workspace_id,id),
  CONSTRAINT workspace_catalog_assets_record_fk FOREIGN KEY(workspace_id,catalog_record_id) REFERENCES workspace_catalog_records(workspace_id,id),
  CONSTRAINT workspace_catalog_assets_role_check CHECK(role IN ('primary_image','gallery_image','technical_drawing')),
  CONSTRAINT workspace_catalog_assets_name_check CHECK(length(btrim(original_name)) BETWEEN 1 AND 240),
  CONSTRAINT workspace_catalog_assets_mime_check CHECK(
    mime_type IN ('image/jpeg','image/png','image/webp','image/gif','image/avif','image/heic','application/pdf')
    AND (role='technical_drawing' OR mime_type<>'application/pdf')
  ),
  CONSTRAINT workspace_catalog_assets_size_check CHECK(byte_size BETWEEN 1 AND 20971520),
  CONSTRAINT workspace_catalog_assets_sha_check CHECK(sha256~'^[0-9a-f]{64}$'),
  CONSTRAINT workspace_catalog_assets_sort_check CHECK(sort_order BETWEEN 0 AND 1000000),
  CONSTRAINT workspace_catalog_assets_status_check CHECK(status IN ('active','archived')),
  CONSTRAINT workspace_catalog_assets_archive_check CHECK(
    (status='archived' AND archived_reason IS NOT NULL AND length(btrim(archived_reason))>0 AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
    OR (status='active' AND archived_reason IS NULL AND archived_at IS NULL AND archived_by IS NULL)
  ),
  CONSTRAINT workspace_catalog_assets_version_check CHECK(version>0),
  CONSTRAINT workspace_catalog_assets_object_uidx UNIQUE(workspace_id,object_key),
  CONSTRAINT workspace_catalog_assets_preview_uidx UNIQUE(workspace_id,preview_key)
);
CREATE UNIQUE INDEX workspace_catalog_assets_primary_uidx
  ON workspace_catalog_assets(workspace_id,catalog_record_id)
  WHERE role='primary_image' AND status='active';
CREATE INDEX workspace_catalog_assets_record_idx
  ON workspace_catalog_assets(workspace_id,catalog_record_id,status,sort_order,created_at,id);

ALTER TABLE workspace_catalog_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_catalog_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_catalog_assets
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE ON workspace_catalog_assets TO wodana_app;
  END IF;
END $$;
