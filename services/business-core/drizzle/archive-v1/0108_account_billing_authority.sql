CREATE TABLE account_contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE cascade,
  version integer NOT NULL,
  status varchar(30) NOT NULL,
  plan_code varchar(40) NOT NULL,
  plan_version integer NOT NULL,
  currency char(3) NOT NULL,
  billing_cycle varchar(20) NOT NULL,
  recurring_amount numeric(14,2) NOT NULL DEFAULT 0,
  seat_limit integer NOT NULL,
  project_limit integer NOT NULL,
  contract_reference varchar(160),
  signed_at timestamptz,
  trial_ends_at timestamptz,
  term_starts_at timestamptz NOT NULL,
  renews_at timestamptz,
  ends_at timestamptz,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  legal_entity_reference varchar(160),
  tax_validation_state varchar(24) NOT NULL DEFAULT 'unverified',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  reason varchar(500) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_contract_versions_account_version_uidx UNIQUE(account_id,version),
  CONSTRAINT account_contract_versions_status_check CHECK(status IN ('trial_uncontracted','contracted','expired')),
  CONSTRAINT account_contract_versions_cycle_check CHECK(billing_cycle IN ('monthly','yearly','custom')),
  CONSTRAINT account_contract_versions_currency_check CHECK(currency ~ '^[A-Z]{3}$'),
  CONSTRAINT account_contract_versions_amount_check CHECK(recurring_amount>=0),
  CONSTRAINT account_contract_versions_limits_check CHECK(seat_limit>0 AND project_limit>0),
  CONSTRAINT account_contract_versions_version_check CHECK(version>0 AND plan_version>0),
  CONSTRAINT account_contract_versions_signed_check CHECK((status='contracted')=(signed_at IS NOT NULL)),
  CONSTRAINT account_contract_versions_term_check CHECK(ends_at IS NULL OR ends_at>term_starts_at),
  CONSTRAINT account_contract_versions_effective_check CHECK(effective_until IS NULL OR effective_until>effective_from),
  CONSTRAINT account_contract_versions_terms_check CHECK(jsonb_typeof(terms)='object'),
  CONSTRAINT account_contract_versions_tax_check CHECK(tax_validation_state='unverified'),
  CONSTRAINT account_contract_versions_reason_check CHECK(length(btrim(reason)) BETWEEN 10 AND 500)
);
CREATE INDEX account_contract_versions_effective_idx
  ON account_contract_versions(account_id,effective_from DESC,version DESC);
--> statement-breakpoint
CREATE TABLE organization_billing_allocation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
  account_contract_version_id uuid NOT NULL REFERENCES account_contract_versions(id) ON DELETE restrict,
  version integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  allocated_amount numeric(14,2) NOT NULL DEFAULT 0,
  seat_limit integer NOT NULL,
  project_limit integer NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  reason varchar(500) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_billing_allocation_versions_workspace_version_uidx UNIQUE(workspace_id,version),
  CONSTRAINT organization_billing_allocation_versions_status_check CHECK(status IN ('scheduled','active','suspended','ended')),
  CONSTRAINT organization_billing_allocation_versions_amount_check CHECK(allocated_amount>=0),
  CONSTRAINT organization_billing_allocation_versions_limits_check CHECK(seat_limit>0 AND project_limit>0),
  CONSTRAINT organization_billing_allocation_versions_version_check CHECK(version>0),
  CONSTRAINT organization_billing_allocation_versions_time_check CHECK(effective_until IS NULL OR effective_until>effective_from),
  CONSTRAINT organization_billing_allocation_versions_reason_check CHECK(length(btrim(reason)) BETWEEN 10 AND 500)
);
CREATE INDEX organization_billing_allocation_versions_effective_idx
  ON organization_billing_allocation_versions(workspace_id,effective_from DESC,version DESC);
--> statement-breakpoint
CREATE TABLE account_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE cascade,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  source varchar(30) NOT NULL DEFAULT 'computed',
  totals jsonb NOT NULL,
  organization_usage jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  CONSTRAINT account_usage_snapshots_period_check CHECK(period_end>period_start),
  CONSTRAINT account_usage_snapshots_source_check CHECK(source IN ('computed','provider_import')),
  CONSTRAINT account_usage_snapshots_totals_check CHECK(jsonb_typeof(totals)='object'),
  CONSTRAINT account_usage_snapshots_organizations_check CHECK(jsonb_typeof(organization_usage)='array')
);
CREATE INDEX account_usage_snapshots_account_period_idx
  ON account_usage_snapshots(account_id,period_end DESC,captured_at DESC);
--> statement-breakpoint
CREATE TABLE account_billing_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE cascade,
  document_type varchar(20) NOT NULL,
  provider varchar(50) NOT NULL,
  external_reference varchar(255) NOT NULL,
  document_number varchar(120),
  status varchar(24) NOT NULL,
  currency char(3) NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  balance_amount numeric(14,2) NOT NULL,
  issued_at timestamptz,
  due_at timestamptz,
  settled_at timestamptz,
  legal_entity_reference varchar(160),
  tax_validation_state varchar(24) NOT NULL DEFAULT 'unverified',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_billing_documents_external_uidx UNIQUE(account_id,document_type,provider,external_reference),
  CONSTRAINT account_billing_documents_type_check CHECK(document_type IN ('invoice','credit_note','receipt')),
  CONSTRAINT account_billing_documents_status_check CHECK(status IN ('draft','issued','past_due','paid','applied','verified','failed','void','refunded')),
  CONSTRAINT account_billing_documents_currency_check CHECK(currency ~ '^[A-Z]{3}$'),
  CONSTRAINT account_billing_documents_amount_check CHECK(total_amount>=0 AND balance_amount>=0 AND balance_amount<=total_amount),
  CONSTRAINT account_billing_documents_dates_check CHECK(due_at IS NULL OR issued_at IS NULL OR due_at>=issued_at),
  CONSTRAINT account_billing_documents_tax_check CHECK(tax_validation_state='unverified'),
  CONSTRAINT account_billing_documents_metadata_check CHECK(jsonb_typeof(metadata)='object'),
  CONSTRAINT account_billing_documents_version_check CHECK(version>0)
);
CREATE INDEX account_billing_documents_account_status_idx
  ON account_billing_documents(account_id,status,COALESCE(due_at,issued_at,created_at) DESC);
CREATE TRIGGER account_billing_documents_set_updated_at BEFORE UPDATE ON account_billing_documents
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TABLE account_billing_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE cascade,
  document_id uuid NOT NULL REFERENCES account_billing_documents(id) ON DELETE cascade,
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  event_type varchar(40) NOT NULL,
  previous_status varchar(24),
  status varchar(24) NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_billing_document_events_idempotency_uidx UNIQUE(account_id,idempotency_key),
  CONSTRAINT account_billing_document_events_type_check CHECK(event_type IN ('created','provider_notification','finance_verified','corrected')),
  CONSTRAINT account_billing_document_events_status_check CHECK(status IN ('draft','issued','past_due','paid','applied','verified','failed','void','refunded')),
  CONSTRAINT account_billing_document_events_payload_check CHECK(jsonb_typeof(payload)='object')
);
CREATE INDEX account_billing_document_events_document_idx
  ON account_billing_document_events(document_id,occurred_at DESC,recorded_at DESC);
--> statement-breakpoint
CREATE TABLE account_collection_state_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES customer_accounts(id) ON DELETE cascade,
  version integer NOT NULL,
  status varchar(24) NOT NULL,
  overdue_amount numeric(14,2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  next_review_at timestamptz,
  reason varchar(500) NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_collection_state_versions_account_version_uidx UNIQUE(account_id,version),
  CONSTRAINT account_collection_state_versions_status_check CHECK(status IN ('current','grace','past_due','collections','suspended','closed')),
  CONSTRAINT account_collection_state_versions_amount_check CHECK(overdue_amount>=0),
  CONSTRAINT account_collection_state_versions_currency_check CHECK(currency ~ '^[A-Z]{3}$'),
  CONSTRAINT account_collection_state_versions_review_check CHECK(next_review_at IS NULL OR next_review_at>effective_at),
  CONSTRAINT account_collection_state_versions_reason_check CHECK(length(btrim(reason)) BETWEEN 10 AND 500)
);
CREATE INDEX account_collection_state_versions_effective_idx
  ON account_collection_state_versions(account_id,effective_at DESC,version DESC);
--> statement-breakpoint
INSERT INTO account_contract_versions
  (account_id,version,status,plan_code,plan_version,currency,billing_cycle,recurring_amount,
   seat_limit,project_limit,contract_reference,signed_at,trial_ends_at,term_starts_at,renews_at,
   legal_entity_reference,tax_validation_state,effective_from,reason,created_by,created_at)
SELECT contract.account_id,1,contract.status,contract.plan_code,contract.plan_version,contract.currency,
  contract.billing_cycle,COALESCE(subscription.amount,0),contract.seat_limit,contract.project_limit,
  contract.contract_reference,contract.signed_at,contract.trial_ends_at,
  COALESCE(subscription.started_at,contract.created_at),subscription.renews_at,NULL,'unverified',
  contract.created_at,'Migrated from the legacy account contract billing record',account.created_by,contract.created_at
FROM customer_account_contracts contract
JOIN customer_accounts account ON account.id=contract.account_id
LEFT JOIN LATERAL (
  SELECT legacy.amount,legacy.started_at,legacy.renews_at
  FROM customer_account_organizations linked
  JOIN workspace_subscriptions legacy ON legacy.workspace_id=linked.workspace_id
  WHERE linked.account_id=contract.account_id
  ORDER BY linked.is_default DESC,linked.workspace_id
  LIMIT 1
) subscription ON true;
--> statement-breakpoint
INSERT INTO organization_billing_allocation_versions
  (workspace_id,account_contract_version_id,version,status,allocated_amount,seat_limit,project_limit,
   effective_from,effective_until,reason,created_by,created_at)
SELECT linked.workspace_id,contract_version.id,1,
  CASE legacy.status WHEN 'cancelled' THEN 'ended' ELSE 'active' END,
  legacy.amount,legacy.seat_limit,legacy.project_limit,legacy.started_at,
  CASE WHEN legacy.status='cancelled' THEN COALESCE(legacy.renews_at,legacy.updated_at) ELSE NULL END,
  'Migrated from the legacy organization subscription allocation',account.created_by,legacy.created_at
FROM customer_account_organizations linked
JOIN customer_accounts account ON account.id=linked.account_id
JOIN account_contract_versions contract_version ON contract_version.account_id=linked.account_id AND contract_version.version=1
JOIN workspace_subscriptions legacy ON legacy.workspace_id=linked.workspace_id;
--> statement-breakpoint
INSERT INTO account_collection_state_versions
  (account_id,version,status,overdue_amount,currency,effective_at,reason,created_by)
SELECT contract.account_id,1,
  CASE
    WHEN bool_or(subscription.status='past_due') THEN 'past_due'
    WHEN bool_and(subscription.status='cancelled') THEN 'closed'
    ELSE 'current'
  END,
  0,contract.currency,now(),'Migrated from legacy workspace subscription collection states',account.created_by
FROM customer_account_contracts contract
JOIN customer_accounts account ON account.id=contract.account_id
JOIN customer_account_organizations linked ON linked.account_id=contract.account_id
JOIN workspace_subscriptions subscription ON subscription.workspace_id=linked.workspace_id
GROUP BY contract.account_id,contract.currency,account.created_by;
--> statement-breakpoint
CREATE VIEW effective_account_contracts WITH (security_invoker=true) AS
WITH ranked AS (
  SELECT contract.*,
    row_number() OVER(PARTITION BY account_id ORDER BY
      CASE WHEN now()>=effective_from AND (effective_until IS NULL OR now()<effective_until) THEN 0
           WHEN now()<effective_from THEN 1 ELSE 2 END,
      CASE WHEN now()<effective_from THEN effective_from END ASC,
      CASE WHEN now()>=effective_from THEN effective_from END DESC,
      version DESC) AS rank
  FROM account_contract_versions contract
)
SELECT id,account_id,version,status,plan_code,plan_version,currency,billing_cycle,recurring_amount,
  seat_limit,project_limit,contract_reference,signed_at,trial_ends_at,term_starts_at,renews_at,ends_at,
  terms,legal_entity_reference,tax_validation_state,effective_from,effective_until,reason,created_by,created_at
FROM ranked WHERE rank=1;
--> statement-breakpoint
CREATE VIEW effective_organization_billing_allocations WITH (security_invoker=true) AS
WITH ranked AS (
  SELECT allocation.*,
    row_number() OVER(PARTITION BY workspace_id ORDER BY
      CASE WHEN now()>=effective_from AND (effective_until IS NULL OR now()<effective_until) THEN 0
           WHEN now()<effective_from THEN 1 ELSE 2 END,
      CASE WHEN now()<effective_from THEN effective_from END ASC,
      CASE WHEN now()>=effective_from THEN effective_from END DESC,
      version DESC) AS rank
  FROM organization_billing_allocation_versions allocation
)
SELECT id,workspace_id,account_contract_version_id,version,status,allocated_amount,seat_limit,project_limit,
  effective_from,effective_until,reason,created_by,created_at
FROM ranked WHERE rank=1;
--> statement-breakpoint
ALTER TABLE account_contract_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_contract_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY linked_organization_access ON account_contract_versions USING(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_contract_versions.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
)) WITH CHECK(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_contract_versions.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
));
ALTER TABLE organization_billing_allocation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_billing_allocation_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organization_billing_allocation_versions
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
CREATE POLICY platform_operator_access ON organization_billing_allocation_versions
  USING(EXISTS(
    SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id=NULLIF(current_setting('app.current_actor_id',true),'')::uuid
      AND operator.status='active'
  ))
  WITH CHECK(EXISTS(
    SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id=NULLIF(current_setting('app.current_actor_id',true),'')::uuid
      AND operator.status='active'
  ));
ALTER TABLE account_usage_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_usage_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY linked_organization_access ON account_usage_snapshots USING(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_usage_snapshots.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
)) WITH CHECK(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_usage_snapshots.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
));
ALTER TABLE account_billing_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_billing_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY linked_organization_access ON account_billing_documents USING(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_billing_documents.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
)) WITH CHECK(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_billing_documents.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
));
ALTER TABLE account_billing_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_billing_document_events FORCE ROW LEVEL SECURITY;
CREATE POLICY linked_organization_access ON account_billing_document_events USING(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_billing_document_events.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
)) WITH CHECK(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_billing_document_events.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
));
ALTER TABLE account_collection_state_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_collection_state_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY linked_organization_access ON account_collection_state_versions USING(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_collection_state_versions.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
)) WITH CHECK(EXISTS(
  SELECT 1 FROM customer_account_organizations linked
  WHERE linked.account_id=account_collection_state_versions.account_id
    AND linked.workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid
));
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT ON account_contract_versions TO wodana_app;
    GRANT SELECT,INSERT ON organization_billing_allocation_versions TO wodana_app;
    GRANT SELECT,INSERT ON account_usage_snapshots TO wodana_app;
    GRANT SELECT,INSERT,UPDATE ON account_billing_documents TO wodana_app;
    GRANT SELECT,INSERT ON account_billing_document_events TO wodana_app;
    GRANT SELECT,INSERT ON account_collection_state_versions TO wodana_app;
    GRANT SELECT ON effective_account_contracts,effective_organization_billing_allocations TO wodana_app;
  END IF;
END $$;
