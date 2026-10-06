-- P3 deal side (plan §6.9a, §7a E3-1…E3-6). All new tables are tenant tables with forced RLS and tenant_isolation.
--   * E3 approval engine, as rows: approval_policies → approval_policy_versions (immutable: an edit is a new version;
--     pending requests keep theirs) → approval_policy_steps (approvers in order: a permission, a role or a person);
--     approval_requests (one pending per subject, row-locked and version-checked); approval_decisions (append-only,
--     with who decided for whom and how: direct, delegate, escalation, waiver); approval_delegations (away cover).
--     Product default policies are created per workspace on first use, reproducing the rules before the engine.
--   * PLM-101 / PLM-103 / PLM-009: crm_opportunity_proposals — Proposal 1 (design fee) and Proposal 2 (main quotation)
--     on one opportunity, each with its own value (verified by Finance and locked by the Deal File approver through E3),
--     proof and Won date; crm_opportunity_value_events is the append-only value history (old → new).
--     crm_opportunity_payment_proofs.proposal_kind names which proposal a proof pays; .reading keeps what AI read on it
--     (a proposal Finance confirms, never a value on its own).
--   * PLM-102: crm_flow_closing_rules — the event that closes a deal, per flow (enquiry type) and furniture path, as
--     configuration; crm_deal_fulfilment_events — collection, delivery and installation records the closing is read
--     from (with handover packs, design approval and work orders). Deal Closed is computed, never typed.
--   * PLM-099: workspace_sales_settings.opportunity_reference_prefix — new opportunity references use the configured
--     prefix (product default O-); existing references are left exactly as they are.
-- Runs as the migration owner, so forced RLS is never disabled. Idempotent.
CREATE TABLE IF NOT EXISTS approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject_kind varchar(40) NOT NULL CHECK (subject_kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
-- One product default per kind per workspace, so concurrent first uses create it once.
CREATE UNIQUE INDEX IF NOT EXISTS approval_policies_default_uidx ON approval_policies (workspace_id, subject_kind) WHERE is_default;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approval_policies_kind_idx ON approval_policies (workspace_id, subject_kind, status);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS approval_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  policy_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  currency_code char(3) CHECK (currency_code ~ '^[A-Z]{3}$'),
  min_amount numeric(20,4) CHECK (min_amount >= 0),
  owner_above_amount numeric(20,4) CHECK (owner_above_amount >= 0),
  escalate_after_hours integer CHECK (escalate_after_hours BETWEEN 1 AND 720),
  waiver_allowed boolean NOT NULL DEFAULT false,
  reset_tolerance_percent numeric(7,4) NOT NULL DEFAULT 0 CHECK (reset_tolerance_percent BETWEEN 0 AND 100),
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, policy_id, version_number),
  FOREIGN KEY (workspace_id, policy_id) REFERENCES approval_policies (workspace_id, id) ON DELETE CASCADE,
  -- Amounts are always in a named currency (a threshold is never compared across currencies).
  CONSTRAINT approval_policy_versions_currency_check CHECK ((min_amount IS NULL AND owner_above_amount IS NULL) OR currency_code IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS approval_policy_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  policy_version_id uuid NOT NULL,
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 10),
  approver_kind varchar(12) NOT NULL CHECK (approver_kind IN ('permission', 'role', 'person')),
  permission_code varchar(100),
  role_code varchar(64),
  user_id uuid REFERENCES users (id),
  label varchar(120) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, policy_version_id, position),
  FOREIGN KEY (workspace_id, policy_version_id) REFERENCES approval_policy_versions (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT approval_policy_steps_approver_check CHECK (
    (approver_kind = 'permission' AND permission_code IS NOT NULL AND role_code IS NULL AND user_id IS NULL)
    OR (approver_kind = 'role' AND role_code IS NOT NULL AND permission_code IS NULL AND user_id IS NULL)
    OR (approver_kind = 'person' AND user_id IS NOT NULL AND permission_code IS NULL AND role_code IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  subject_kind varchar(40) NOT NULL CHECK (subject_kind ~ '^[a-z][a-z0-9_]{1,39}$'),
  subject_id uuid NOT NULL,
  title varchar(300) NOT NULL CHECK (length(btrim(title)) > 0),
  href varchar(500),
  amount numeric(20,4) CHECK (amount >= 0),
  currency_code char(3) CHECK (currency_code ~ '^[A-Z]{3}$'),
  previous_amount numeric(20,4),
  policy_version_id uuid NOT NULL,
  owner_step boolean NOT NULL DEFAULT false,
  status varchar(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'returned', 'rejected', 'cancelled', 'superseded')),
  current_step smallint NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 11),
  step_since timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  requested_by uuid NOT NULL REFERENCES users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  supersedes_id uuid,
  superseded_by_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, policy_version_id) REFERENCES approval_policy_versions (workspace_id, id),
  FOREIGN KEY (workspace_id, supersedes_id) REFERENCES approval_requests (workspace_id, id),
  CONSTRAINT approval_requests_money_check CHECK ((amount IS NULL) = (currency_code IS NULL)),
  CONSTRAINT approval_requests_decided_check CHECK ((status IN ('pending', 'superseded')) OR decided_at IS NOT NULL)
);
--> statement-breakpoint
-- At most one open request per subject: a second request for the same subject reuses or replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_one_pending_uidx ON approval_requests (workspace_id, subject_kind, subject_id) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approval_requests_subject_idx ON approval_requests (workspace_id, subject_kind, subject_id, requested_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approval_requests_pending_idx ON approval_requests (workspace_id, step_since) WHERE status = 'pending';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  step_position smallint NOT NULL CHECK (step_position BETWEEN 1 AND 11),
  decision varchar(12) NOT NULL CHECK (decision IN ('approve', 'return', 'reject', 'escalated', 'amended', 'cancelled')),
  decided_by uuid REFERENCES users (id),
  on_behalf_of uuid REFERENCES users (id),
  via varchar(12) NOT NULL DEFAULT 'direct' CHECK (via IN ('direct', 'delegate', 'escalation', 'waiver', 'legacy', 'system')),
  note varchar(1000),
  from_amount numeric(20,4),
  to_amount numeric(20,4),
  command_id uuid,
  decided_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, request_id) REFERENCES approval_requests (workspace_id, id) ON DELETE CASCADE,
  -- A waiver is always explained.
  CONSTRAINT approval_decisions_waiver_check CHECK (via <> 'waiver' OR length(btrim(coalesce(note, ''))) > 0),
  CONSTRAINT approval_decisions_person_check CHECK (decision IN ('escalated', 'amended', 'cancelled') OR decided_by IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS approval_decisions_command_uidx ON approval_decisions (workspace_id, command_id) WHERE command_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS approval_decisions_escalated_uidx ON approval_decisions (workspace_id, request_id, step_position) WHERE decision = 'escalated';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approval_decisions_request_idx ON approval_decisions (workspace_id, request_id, decided_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS approval_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  delegate_user_id uuid NOT NULL REFERENCES users (id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  note varchar(500) NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users (id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  CONSTRAINT approval_delegations_self_check CHECK (user_id <> delegate_user_id),
  CONSTRAINT approval_delegations_window_check CHECK (ends_at > starts_at)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS approval_delegations_delegate_idx ON approval_delegations (workspace_id, delegate_user_id, ends_at) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION approval_rows_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; record a new row instead', TG_TABLE_NAME USING ERRCODE = '55000';
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS approval_policy_versions_immutable ON approval_policy_versions;
--> statement-breakpoint
CREATE TRIGGER approval_policy_versions_immutable BEFORE UPDATE ON approval_policy_versions FOR EACH ROW EXECUTE FUNCTION approval_rows_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS approval_policy_steps_immutable ON approval_policy_steps;
--> statement-breakpoint
CREATE TRIGGER approval_policy_steps_immutable BEFORE UPDATE ON approval_policy_steps FOR EACH ROW EXECUTE FUNCTION approval_rows_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS approval_decisions_immutable ON approval_decisions;
--> statement-breakpoint
CREATE TRIGGER approval_decisions_immutable BEFORE UPDATE ON approval_decisions FOR EACH ROW EXECUTE FUNCTION approval_rows_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON approval_policies;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON approval_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON approval_requests;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON approval_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_opportunity_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL CHECK (kind IN ('design', 'main')),
  amount numeric(20,4) CHECK (amount >= 0),
  currency_code char(3) CHECK (currency_code ~ '^[A-Z]{3}$'),
  value_status varchar(12) NOT NULL DEFAULT 'empty' CHECK (value_status IN ('empty', 'entered', 'verified', 'approved')),
  entered_by uuid REFERENCES users (id),
  entered_at timestamptz,
  verified_by uuid REFERENCES users (id),
  verified_at timestamptz,
  approved_by uuid REFERENCES users (id),
  approved_at timestamptz,
  won_at timestamptz,
  quote_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT crm_opportunity_proposals_money_check CHECK ((amount IS NULL) = (currency_code IS NULL)),
  CONSTRAINT crm_opportunity_proposals_kind_uidx UNIQUE (workspace_id, opportunity_id, kind)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_opportunity_proposals_won_idx ON crm_opportunity_proposals (workspace_id, won_at) WHERE won_at IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_opportunity_value_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  proposal_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('design', 'main')),
  action varchar(12) NOT NULL CHECK (action IN ('entered', 'changed', 'verified', 'approved', 'returned', 'won')),
  from_amount numeric(20,4),
  to_amount numeric(20,4),
  currency_code char(3),
  note varchar(1000),
  actor_user_id uuid REFERENCES users (id),
  at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, proposal_id) REFERENCES crm_opportunity_proposals (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_opportunity_value_events_opportunity_idx ON crm_opportunity_value_events (workspace_id, opportunity_id, at DESC);
--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_opportunity_value_events_immutable ON crm_opportunity_value_events;
--> statement-breakpoint
CREATE TRIGGER crm_opportunity_value_events_immutable BEFORE UPDATE ON crm_opportunity_value_events FOR EACH ROW EXECUTE FUNCTION approval_rows_immutable();
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON crm_opportunity_proposals;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_opportunity_proposals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
ALTER TABLE crm_opportunity_payment_proofs ADD COLUMN IF NOT EXISTS proposal_kind varchar(10);
--> statement-breakpoint
ALTER TABLE crm_opportunity_payment_proofs DROP CONSTRAINT IF EXISTS crm_opportunity_payment_proofs_proposal_check;
--> statement-breakpoint
ALTER TABLE crm_opportunity_payment_proofs ADD CONSTRAINT crm_opportunity_payment_proofs_proposal_check CHECK (proposal_kind IS NULL OR proposal_kind IN ('design', 'main'));
--> statement-breakpoint
ALTER TABLE crm_opportunity_payment_proofs ADD COLUMN IF NOT EXISTS reading jsonb;
--> statement-breakpoint
ALTER TABLE crm_opportunity_payment_proofs DROP CONSTRAINT IF EXISTS crm_opportunity_payment_proofs_reading_check;
--> statement-breakpoint
ALTER TABLE crm_opportunity_payment_proofs ADD CONSTRAINT crm_opportunity_payment_proofs_reading_check CHECK (reading IS NULL OR jsonb_typeof(reading) = 'object');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_flow_closing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  flow_id uuid NOT NULL,
  furniture_path varchar(30) CHECK (furniture_path IS NULL OR furniture_path IN ('take_home_now', 'in_stock_delivery', 'supplier_order', 'core_collection_factory', 'bespoke')),
  closing_event varchar(40) NOT NULL CHECK (closing_event IN ('collected', 'delivered', 'collected_or_delivered', 'design_handover', 'all_produced_delivered_installed', 'completion_handover')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, flow_id) REFERENCES crm_flows (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_flow_closing_rules_uidx ON crm_flow_closing_rules (workspace_id, flow_id, coalesce(furniture_path, ''));
--> statement-breakpoint
DROP TRIGGER IF EXISTS set_updated_at ON crm_flow_closing_rules;
--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON crm_flow_closing_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_deal_fulfilment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  event varchar(12) NOT NULL CHECK (event IN ('collected', 'delivered', 'installed')),
  received_by varchar(200) NOT NULL DEFAULT '',
  note varchar(1000) NOT NULL DEFAULT '',
  command_id uuid,
  recorded_by uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_deal_fulfilment_events_command_uidx ON crm_deal_fulfilment_events (workspace_id, command_id) WHERE command_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_deal_fulfilment_events_opportunity_idx ON crm_deal_fulfilment_events (workspace_id, opportunity_id, recorded_at);
--> statement-breakpoint
DROP TRIGGER IF EXISTS crm_deal_fulfilment_events_immutable ON crm_deal_fulfilment_events;
--> statement-breakpoint
CREATE TRIGGER crm_deal_fulfilment_events_immutable BEFORE UPDATE ON crm_deal_fulfilment_events FOR EACH ROW EXECUTE FUNCTION approval_rows_immutable();
--> statement-breakpoint
ALTER TABLE workspace_sales_settings ADD COLUMN IF NOT EXISTS opportunity_reference_prefix varchar(8) NOT NULL DEFAULT 'O-';
--> statement-breakpoint
ALTER TABLE workspace_sales_settings DROP CONSTRAINT IF EXISTS workspace_sales_settings_opportunity_prefix_check;
--> statement-breakpoint
ALTER TABLE workspace_sales_settings ADD CONSTRAINT workspace_sales_settings_opportunity_prefix_check CHECK (opportunity_reference_prefix ~ '^[A-Z][A-Z0-9]{0,5}-?$');
--> statement-breakpoint
-- New references take the workspace's prefix; a reference once given never changes.
CREATE OR REPLACE FUNCTION public.crm_allocate_opportunity_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE allocated bigint; reference_prefix text;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
   RAISE EXCEPTION 'Opportunity reference and workspace cannot be changed';
  END IF;
 ELSE
  INSERT INTO crm_opportunity_counters (workspace_id, last_value) VALUES (NEW.workspace_id, 1)
  ON CONFLICT (workspace_id) DO UPDATE SET last_value = crm_opportunity_counters.last_value + 1
  RETURNING last_value INTO allocated;
  SELECT settings.opportunity_reference_prefix INTO reference_prefix FROM workspace_sales_settings settings WHERE settings.workspace_id = NEW.workspace_id;
  NEW.reference := coalesce(reference_prefix, 'O-') || lpad(allocated::text, greatest(4, length(allocated::text)), '0');
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['approval_policies', 'approval_policy_versions', 'approval_policy_steps', 'approval_requests', 'approval_decisions',
    'approval_delegations', 'crm_opportunity_proposals', 'crm_opportunity_value_events', 'crm_flow_closing_rules', 'crm_deal_fulfilment_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON approval_policies, approval_requests, approval_delegations, crm_opportunity_proposals, crm_flow_closing_rules TO wodana_app;
    -- A path's own closing rule is removed when the firm goes back to the type's default.
    GRANT DELETE ON crm_flow_closing_rules TO wodana_app;
    -- Versions, steps, decisions, value history and fulfilment records are append-only for the app role.
    GRANT SELECT, INSERT ON approval_policy_versions, approval_policy_steps, approval_decisions, crm_opportunity_value_events, crm_deal_fulfilment_events TO wodana_app;
    GRANT EXECUTE ON FUNCTION approval_rows_immutable() TO wodana_app;
    -- The AI reading is the only thing ever written on a stored payment proof.
    GRANT UPDATE (reading) ON crm_opportunity_payment_proofs TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('approvals.requested', 'in_app', 'To approve · {{title}}', '{{actor}} asks for your approval{{amountText}}.', '["title","actor","amountText","step"]'),
  ('approvals.requested', 'email', 'To approve · {{title}}', E'{{actor}} asks for your approval{{amountText}}.\n\nStep: {{step}}.', '["title","actor","amountText","step"]'),
  ('approvals.decided', 'in_app', '{{title}} · {{outcome}}', '{{actor}}: {{note}}', '["title","actor","outcome","note"]'),
  ('approvals.escalated_step', 'in_app', 'Escalated to you · {{title}}', 'It waited {{hours}} hours at {{step}}.', '["title","hours","step"]'),
  ('opportunity.proof_read', 'in_app', 'Payment proof read · {{clientName}}', 'The proof for {{title}} reads {{amount}}. Confirm or correct it.', '["title","clientName","amount"]')
) AS template(code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
