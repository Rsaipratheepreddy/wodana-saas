-- The supplier register for purchasing: what each supplier supplies, whether the firm approved it (and
-- for which categories it is the preferred supplier), its payment terms, any discount or commission
-- deal, and the buying companies (legal entities) that buy from it.
ALTER TABLE workspace_vendors
  ADD COLUMN categories varchar(60)[] NOT NULL DEFAULT '{}',
  ADD COLUMN approval varchar(16) NOT NULL DEFAULT 'pending' CHECK (approval IN ('pending', 'approved', 'not_approved', 'on_hold')),
  ADD COLUMN preferred_for varchar(60)[] NOT NULL DEFAULT '{}',
  ADD COLUMN approval_note varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN approval_at timestamptz,
  ADD COLUMN approval_by uuid REFERENCES users (id),
  ADD COLUMN payment_terms varchar(12) NOT NULL DEFAULT 'upfront' CHECK (payment_terms IN ('upfront', 'on_delivery', 'split', 'credit', 'statement')),
  ADD COLUMN advance_percent numeric(5, 2) CHECK (advance_percent IS NULL OR (advance_percent > 0 AND advance_percent < 100)),
  ADD COLUMN credit_days integer CHECK (credit_days IS NULL OR credit_days BETWEEN 1 AND 365),
  ADD COLUMN terms_note varchar(500) NOT NULL DEFAULT '',
  ADD COLUMN deal varchar(12) NOT NULL DEFAULT 'none' CHECK (deal IN ('none', 'discount', 'commission', 'on_request')),
  ADD COLUMN deal_percent numeric(5, 2) CHECK (deal_percent IS NULL OR (deal_percent > 0 AND deal_percent < 100)),
  ADD COLUMN deal_note varchar(500) NOT NULL DEFAULT '',
  ADD CONSTRAINT workspace_vendors_split_terms_check CHECK ((payment_terms = 'split') = (advance_percent IS NOT NULL)),
  ADD CONSTRAINT workspace_vendors_credit_terms_check CHECK ((payment_terms = 'credit') = (credit_days IS NOT NULL)),
  ADD CONSTRAINT workspace_vendors_deal_kind_check CHECK (deal IN ('discount', 'commission') OR deal_percent IS NULL),
  ADD CONSTRAINT workspace_vendors_preferred_check CHECK (preferred_for <@ categories),
  ADD CONSTRAINT workspace_vendors_approval_by_check CHECK ((approval = 'pending') = (approval_at IS NULL));
--> statement-breakpoint
CREATE TABLE vendor_legal_entities (
  workspace_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, vendor_id, legal_entity_id),
  FOREIGN KEY (workspace_id, vendor_id) REFERENCES workspace_vendors (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, legal_entity_id) REFERENCES legal_entities (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX vendor_legal_entities_entity_idx ON vendor_legal_entities (workspace_id, legal_entity_id);
--> statement-breakpoint
CREATE INDEX workspace_vendors_categories_idx ON workspace_vendors USING gin (categories);
--> statement-breakpoint
ALTER TABLE vendor_legal_entities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE vendor_legal_entities FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON vendor_legal_entities
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, DELETE ON vendor_legal_entities TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('vendors.approve', 'Approve suppliers, name preferred suppliers and put suppliers on hold'),
  ('purchasing.view', 'See purchase orders, supplier prices and what projects still need to order'),
  ('purchasing.manage', 'Create, send and confirm purchase orders and price requests'),
  ('purchasing.approve', 'Approve purchase orders raised by someone else')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- The firm's owners and administrators get the new permissions; other roles are set in Settings.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator')
   AND permission.code IN ('vendors.approve', 'purchasing.view', 'purchasing.manage', 'purchasing.approve')
ON CONFLICT (role_id, permission_id) DO NOTHING;
