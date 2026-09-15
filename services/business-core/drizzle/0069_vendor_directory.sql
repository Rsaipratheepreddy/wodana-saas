CREATE TABLE workspace_vendors (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  code varchar(80) NOT NULL,
  display_name varchar(240) NOT NULL,
  legal_name varchar(240),
  capabilities varchar(24)[] NOT NULL DEFAULT '{}',
  registration_number varchar(120),
  tax_registration_number varchar(120),
  default_currency char(3),
  website varchar(500),
  notes text NOT NULL DEFAULT '',
  status varchar(16) NOT NULL DEFAULT 'draft',
  archived_reason varchar(500),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_vendors_pk PRIMARY KEY (workspace_id,id),
  CONSTRAINT workspace_vendors_code_check CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,79}$'),
  CONSTRAINT workspace_vendors_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 240),
  CONSTRAINT workspace_vendors_status_check CHECK (status IN ('draft','active','archived')),
  CONSTRAINT workspace_vendors_capabilities_check CHECK (capabilities <@ ARRAY['materials','services','subcontracting','manufacturing','logistics','other']::varchar[]),
  CONSTRAINT workspace_vendors_active_capability_check CHECK (status <> 'active' OR cardinality(capabilities) > 0),
  CONSTRAINT workspace_vendors_currency_check CHECK (default_currency IS NULL OR default_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT workspace_vendors_archive_check CHECK (
    (status='archived' AND archived_reason IS NOT NULL AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
    OR (status<>'archived' AND archived_reason IS NULL AND archived_at IS NULL AND archived_by IS NULL)
  ),
  CONSTRAINT workspace_vendors_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX workspace_vendors_code_uidx ON workspace_vendors(workspace_id,lower(code));
CREATE UNIQUE INDEX workspace_vendors_registration_uidx ON workspace_vendors(workspace_id,lower(btrim(registration_number))) WHERE registration_number IS NOT NULL;
CREATE UNIQUE INDEX workspace_vendors_tax_registration_uidx ON workspace_vendors(workspace_id,lower(btrim(tax_registration_number))) WHERE tax_registration_number IS NOT NULL;
CREATE INDEX workspace_vendors_name_idx ON workspace_vendors(workspace_id,lower(display_name),id);
CREATE INDEX workspace_vendors_status_idx ON workspace_vendors(workspace_id,status,updated_at DESC);

CREATE TABLE workspace_vendor_sites (
  workspace_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  id uuid NOT NULL,
  name varchar(180) NOT NULL,
  site_type varchar(20) NOT NULL,
  contact_name varchar(180),
  email varchar(320),
  phone varchar(80),
  address_line1 varchar(240),
  address_line2 varchar(240),
  locality varchar(160),
  region varchar(160),
  postal_code varchar(40),
  country_code char(2),
  is_primary boolean NOT NULL DEFAULT false,
  status varchar(16) NOT NULL DEFAULT 'active',
  archived_reason varchar(500),
  archived_at timestamptz,
  archived_by uuid REFERENCES users(id),
  version integer NOT NULL DEFAULT 1,
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_vendor_sites_pk PRIMARY KEY (workspace_id,id),
  CONSTRAINT workspace_vendor_sites_vendor_fk FOREIGN KEY(workspace_id,vendor_id) REFERENCES workspace_vendors(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT workspace_vendor_sites_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 180),
  CONSTRAINT workspace_vendor_sites_type_check CHECK (site_type IN ('branch','store','office','warehouse','factory','other')),
  CONSTRAINT workspace_vendor_sites_status_check CHECK (status IN ('active','archived')),
  CONSTRAINT workspace_vendor_sites_country_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT workspace_vendor_sites_archive_check CHECK (
    (status='archived' AND NOT is_primary AND archived_reason IS NOT NULL AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
    OR (status='active' AND archived_reason IS NULL AND archived_at IS NULL AND archived_by IS NULL)
  ),
  CONSTRAINT workspace_vendor_sites_version_check CHECK (version > 0)
);
CREATE UNIQUE INDEX workspace_vendor_sites_primary_uidx ON workspace_vendor_sites(workspace_id,vendor_id) WHERE status='active' AND is_primary;
CREATE INDEX workspace_vendor_sites_vendor_idx ON workspace_vendor_sites(workspace_id,vendor_id,status,name);

ALTER TABLE workspace_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_vendors FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_vendors
  USING (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
ALTER TABLE workspace_vendor_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_vendor_sites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_vendor_sites
  USING (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE ON workspace_vendors,workspace_vendor_sites TO wodana_app;
  END IF;
END $$;

INSERT INTO permissions(code,description) VALUES
  ('vendors.view','View the workspace vendor directory and vendor locations'),
  ('vendors.manage','Create and maintain workspace vendors and vendor locations')
ON CONFLICT(code) DO NOTHING;

ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT role.workspace_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system AND role.code IN ('owner','administrator')
  AND permission.code IN ('vendors.view','vendors.manage')
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
