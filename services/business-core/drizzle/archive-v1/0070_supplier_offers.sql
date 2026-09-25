ALTER TABLE workspace_vendor_sites
  ADD CONSTRAINT workspace_vendor_sites_vendor_identity_uq UNIQUE(workspace_id,vendor_id,id);

CREATE TABLE workspace_supplier_offers (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  vendor_site_id uuid,
  catalog_record_id uuid NOT NULL,
  unit_record_id uuid,
  supplier_sku varchar(120),
  amount numeric(20,6),
  currency char(3),
  quantity_from numeric(20,6),
  minimum_order_quantity numeric(20,6),
  order_multiple numeric(20,6),
  lead_time_days integer,
  effective_from date,
  effective_to date,
  source_type varchar(24),
  source_reference varchar(240),
  tax_treatment varchar(20) NOT NULL DEFAULT 'unconfirmed',
  inclusions varchar(24)[] NOT NULL DEFAULT '{}',
  terms text NOT NULL DEFAULT '',
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
  CONSTRAINT workspace_supplier_offers_pk PRIMARY KEY(workspace_id,id),
  CONSTRAINT workspace_supplier_offers_vendor_fk FOREIGN KEY(workspace_id,vendor_id) REFERENCES workspace_vendors(workspace_id,id),
  CONSTRAINT workspace_supplier_offers_site_fk FOREIGN KEY(workspace_id,vendor_id,vendor_site_id) REFERENCES workspace_vendor_sites(workspace_id,vendor_id,id),
  CONSTRAINT workspace_supplier_offers_catalog_fk FOREIGN KEY(workspace_id,catalog_record_id) REFERENCES workspace_catalog_records(workspace_id,id),
  CONSTRAINT workspace_supplier_offers_unit_fk FOREIGN KEY(workspace_id,unit_record_id) REFERENCES workspace_catalog_records(workspace_id,id),
  CONSTRAINT workspace_supplier_offers_status_check CHECK(status IN ('draft','active','archived')),
  CONSTRAINT workspace_supplier_offers_amount_check CHECK(amount IS NULL OR amount>=0),
  CONSTRAINT workspace_supplier_offers_currency_check CHECK(currency IS NULL OR currency~'^[A-Z]{3}$'),
  CONSTRAINT workspace_supplier_offers_quantity_from_check CHECK(quantity_from IS NULL OR quantity_from>0),
  CONSTRAINT workspace_supplier_offers_minimum_order_check CHECK(minimum_order_quantity IS NULL OR minimum_order_quantity>0),
  CONSTRAINT workspace_supplier_offers_multiple_check CHECK(order_multiple IS NULL OR order_multiple>0),
  CONSTRAINT workspace_supplier_offers_lead_time_check CHECK(lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 3650),
  CONSTRAINT workspace_supplier_offers_dates_check CHECK(effective_from IS NULL OR effective_to IS NULL OR effective_to>=effective_from),
  CONSTRAINT workspace_supplier_offers_source_check CHECK(source_type IS NULL OR source_type IN ('vendor_quote','price_list','contract','verbal_confirmation','estimate','included')),
  CONSTRAINT workspace_supplier_offers_tax_check CHECK(tax_treatment IN ('unconfirmed','exclusive','inclusive','not_applicable')),
  CONSTRAINT workspace_supplier_offers_inclusions_check CHECK(inclusions <@ ARRAY['delivery','unloading','installation','packaging','warranty','other']::varchar[]),
  CONSTRAINT workspace_supplier_offers_zero_check CHECK(amount IS NULL OR (amount=0 AND source_type IS NOT DISTINCT FROM 'included') OR (amount>0 AND source_type IS DISTINCT FROM 'included')),
  CONSTRAINT workspace_supplier_offers_active_check CHECK(status<>'active' OR (unit_record_id IS NOT NULL AND amount IS NOT NULL AND currency IS NOT NULL AND effective_from IS NOT NULL AND source_type IS NOT NULL AND source_reference IS NOT NULL AND length(btrim(source_reference))>0 AND tax_treatment<>'unconfirmed')),
  CONSTRAINT workspace_supplier_offers_archive_check CHECK(
    (status='archived' AND archived_reason IS NOT NULL AND length(btrim(archived_reason))>0 AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
    OR (status<>'archived' AND archived_reason IS NULL AND archived_at IS NULL AND archived_by IS NULL)
  ),
  CONSTRAINT workspace_supplier_offers_version_check CHECK(version>0)
);
CREATE INDEX workspace_supplier_offers_catalog_idx ON workspace_supplier_offers(workspace_id,catalog_record_id,status,effective_from);
CREATE INDEX workspace_supplier_offers_vendor_idx ON workspace_supplier_offers(workspace_id,vendor_id,status,updated_at DESC);
CREATE UNIQUE INDEX workspace_supplier_offers_exact_tier_uidx
  ON workspace_supplier_offers(workspace_id,vendor_id,coalesce(vendor_site_id,'00000000-0000-0000-0000-000000000000'::uuid),catalog_record_id,unit_record_id,currency,effective_from,coalesce(quantity_from,0))
  WHERE status='active';

CREATE TABLE workspace_supplier_offer_commands (
  workspace_id uuid NOT NULL,
  request_id uuid NOT NULL,
  offer_id uuid NOT NULL,
  action varchar(20) NOT NULL,
  request_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_supplier_offer_commands_pk PRIMARY KEY(workspace_id,request_id),
  CONSTRAINT workspace_supplier_offer_commands_offer_fk FOREIGN KEY(workspace_id,offer_id) REFERENCES workspace_supplier_offers(workspace_id,id),
  CONSTRAINT workspace_supplier_offer_commands_action_check CHECK(action IN ('activate','archive','restore')),
  CONSTRAINT workspace_supplier_offer_commands_hash_check CHECK(request_hash~'^[0-9a-f]{64}$')
);
CREATE INDEX workspace_supplier_offer_commands_offer_idx ON workspace_supplier_offer_commands(workspace_id,offer_id,created_at);

ALTER TABLE workspace_supplier_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_supplier_offers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_supplier_offers
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
ALTER TABLE workspace_supplier_offer_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_supplier_offer_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workspace_supplier_offer_commands
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE ON workspace_supplier_offers TO wodana_app;
    GRANT SELECT,INSERT ON workspace_supplier_offer_commands TO wodana_app;
  END IF;
END $$;

INSERT INTO permissions(code,description) VALUES
  ('supplier_offers.view','View supplier costs and commercial sourcing terms'),
  ('supplier_offers.manage','Create and maintain supplier offers')
ON CONFLICT(code) DO NOTHING;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT role.workspace_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system AND role.code IN ('owner','administrator')
  AND permission.code IN ('supplier_offers.view','supplier_offers.manage')
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
