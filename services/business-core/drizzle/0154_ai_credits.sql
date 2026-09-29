-- AI credits. One credit is US$0.001 of model cost. The platform keeps one rate per model (list price
-- times a margin, in credits per million tokens); each workspace has a balance and an append-only
-- ledger of grants, top-ups, usage, adjustments and refunds. The gateway refuses calls at zero and
-- debits each successful call; failed calls cost nothing.

-- Model rates are platform pricing, not tenant data: the app role reads them; only an active Wodana
-- operator changes them, through control_plane_set_ai_model_rate().
CREATE TABLE ai_model_rates (
  model varchar(120) PRIMARY KEY,
  provider varchar(20) NOT NULL CHECK (provider IN ('bedrock', 'gemini')),
  label varchar(80) NOT NULL,
  list_input_usd_per_million numeric(12, 4) NOT NULL CHECK (list_input_usd_per_million >= 0),
  list_output_usd_per_million numeric(12, 4) NOT NULL CHECK (list_output_usd_per_million >= 0),
  margin numeric(6, 3) NOT NULL DEFAULT 1.5 CHECK (margin > 0 AND margin <= 100),
  input_credits_per_million numeric(14, 4) GENERATED ALWAYS AS (round(list_input_usd_per_million * 1000 * margin, 4)) STORED,
  output_credits_per_million numeric(14, 4) GENERATED ALWAYS AS (round(list_output_usd_per_million * 1000 * margin, 4)) STORED,
  price_confirmed boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- List prices in US$ per million input / output tokens. Confirmed prices come from the owner; the
-- others are conservative until confirmed in the internal portal.
INSERT INTO ai_model_rates (model, provider, label, list_input_usd_per_million, list_output_usd_per_million, price_confirmed) VALUES
  ('apac.amazon.nova-micro-v1:0', 'bedrock', 'Amazon Nova Micro', 0.035, 0.14, true),
  ('apac.amazon.nova-lite-v1:0', 'bedrock', 'Amazon Nova Lite', 0.06, 0.24, true),
  ('global.amazon.nova-2-lite-v1:0', 'bedrock', 'Amazon Nova 2 Lite', 0.35, 2.75, false),
  ('openai.gpt-oss-20b-1:0', 'bedrock', 'gpt-oss-20b', 0.08, 0.35, false),
  ('openai.gpt-oss-120b-1:0', 'bedrock', 'gpt-oss-120b', 0.18, 0.70, false),
  ('global.anthropic.claude-haiku-4-5-20251001-v1:0', 'bedrock', 'Claude Haiku 4.5', 1.10, 5.50, false),
  ('gemini-3.1-flash-lite', 'gemini', 'Gemini 3.1 Flash-Lite', 0.25, 1.50, true),
  ('gemini-3.5-flash', 'gemini', 'Gemini 3.5 Flash', 1.50, 9.00, true)
ON CONFLICT (model) DO NOTHING;
--> statement-breakpoint
CREATE TABLE ai_credit_accounts (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  balance numeric(14, 4) NOT NULL DEFAULT 0,
  -- NULL: 20% of the balance right after the last grant or top-up.
  low_balance_threshold numeric(14, 4) CHECK (low_balance_threshold IS NULL OR low_balance_threshold >= 0),
  last_top_up_credits numeric(14, 4),
  last_top_up_balance numeric(14, 4),
  last_top_up_at timestamptz,
  low_balance_notified_at timestamptz,
  exhausted_notified_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE ai_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES ai_credit_accounts (workspace_id) ON DELETE CASCADE,
  entry_type varchar(20) NOT NULL CHECK (entry_type IN ('grant', 'top_up', 'usage', 'adjustment', 'refund')),
  credits numeric(14, 4) NOT NULL,
  balance_after numeric(14, 4) NOT NULL,
  model varchar(120),
  feature varchar(60),
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  reference varchar(200),
  note varchar(500),
  idempotency_key varchar(160) NOT NULL,
  created_by uuid,
  -- The moment of the entry itself, so entries written in one transaction keep their order.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_credit_ledger_sign_check CHECK (
    (entry_type = 'usage' AND credits <= 0)
    OR (entry_type IN ('grant', 'top_up', 'refund') AND credits > 0)
    OR (entry_type = 'adjustment' AND credits <> 0)),
  CONSTRAINT ai_credit_ledger_usage_check CHECK (entry_type <> 'usage' OR (model IS NOT NULL AND feature IS NOT NULL)),
  UNIQUE (workspace_id, idempotency_key)
);
--> statement-breakpoint
CREATE INDEX ai_credit_ledger_recent_idx ON ai_credit_ledger (workspace_id, created_at DESC);
--> statement-breakpoint
-- This month's use by feature, and today's use for the daily caps.
CREATE INDEX ai_credit_ledger_usage_idx ON ai_credit_ledger (workspace_id, created_at, feature) WHERE entry_type = 'usage';
--> statement-breakpoint
CREATE INDEX ai_credit_ledger_platform_usage_idx ON ai_credit_ledger (created_at) WHERE entry_type = 'usage';
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ai_credit_accounts', 'ai_credit_ledger'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON ai_credit_accounts TO wodana_app;
    -- The ledger is append-only.
    GRANT SELECT, INSERT ON ai_credit_ledger TO wodana_app;
    GRANT SELECT ON ai_model_rates TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint

-- The platform-wide daily cap: today's (UTC) usage across every workspace, as one number. The app role
-- cannot read other workspaces' ledgers, so the total comes from here.
CREATE FUNCTION ai_platform_usage_today() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(-sum(entry.credits), 0)::numeric(14, 4) FROM ai_credit_ledger entry
   WHERE entry.entry_type = 'usage' AND entry.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
$$;
--> statement-breakpoint

-- The internal portal's AI credits list: balance, this month's use and the last top-up per organization.
-- Only an active Wodana operator, set as the transaction's actor, may call it.
CREATE FUNCTION control_plane_ai_credits()
RETURNS TABLE (
  workspace_id uuid, account_id uuid, external_tenant_id varchar, organization_name varchar, slug varchar,
  has_account boolean, balance numeric, low_balance_threshold numeric, last_top_up_balance numeric,
  used_this_month numeric, used_today numeric, last_top_up_credits numeric, last_top_up_at timestamptz, ai_enabled boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM platform_administrators operator
     WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid
       AND operator.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Wodana operator access is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT workspace.id, linked.account_id, request.external_tenant_id, workspace.name, workspace.slug,
         account.workspace_id IS NOT NULL, account.balance, account.low_balance_threshold, account.last_top_up_balance,
         COALESCE((SELECT -sum(entry.credits) FROM ai_credit_ledger entry WHERE entry.workspace_id = workspace.id
                    AND entry.entry_type = 'usage'
                    AND entry.created_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')), 0)::numeric,
         COALESCE((SELECT -sum(entry.credits) FROM ai_credit_ledger entry WHERE entry.workspace_id = workspace.id
                    AND entry.entry_type = 'usage'
                    AND entry.created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')), 0)::numeric,
         account.last_top_up_credits, account.last_top_up_at,
         COALESCE((SELECT setting.enabled FROM workspace_ai_settings setting WHERE setting.workspace_id = workspace.id), false)
    FROM workspaces workspace
    LEFT JOIN customer_account_organizations linked ON linked.workspace_id = workspace.id
    LEFT JOIN ai_credit_accounts account ON account.workspace_id = workspace.id
    LEFT JOIN LATERAL (
      SELECT provisioning.external_tenant_id FROM tenant_provisioning_requests provisioning
       WHERE provisioning.workspace_id = workspace.id ORDER BY provisioning.created_at DESC LIMIT 1
    ) request ON true
   WHERE workspace.status <> 'archived'
     AND (request.external_tenant_id IS NULL OR request.external_tenant_id NOT LIKE 'auth-smoke-%');
END $$;
--> statement-breakpoint

-- Rate changes: an active Wodana operator only, version-checked; the credits per million follow from
-- the list price and the margin.
CREATE FUNCTION control_plane_set_ai_model_rate(
  target_model varchar, expected_version integer, input_usd numeric, output_usd numeric, new_margin numeric,
  is_confirmed boolean, is_active boolean
) RETURNS SETOF ai_model_rates
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor uuid := NULLIF(current_setting('app.current_actor_id', true), '')::uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_administrators operator WHERE operator.user_id = actor AND operator.status = 'active') THEN
    RAISE EXCEPTION 'Wodana operator access is required' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH updated AS (
    UPDATE ai_model_rates rate
       SET list_input_usd_per_million = input_usd, list_output_usd_per_million = output_usd, margin = new_margin,
           price_confirmed = is_confirmed, active = is_active, version = rate.version + 1, updated_by = actor, updated_at = now()
     WHERE rate.model = target_model AND rate.version = expected_version
    RETURNING rate.*
  )
  SELECT * FROM updated;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION ai_platform_usage_today() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION control_plane_ai_credits() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION control_plane_set_ai_model_rate(varchar, integer, numeric, numeric, numeric, boolean, boolean) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION ai_platform_usage_today() TO wodana_app;
    GRANT EXECUTE ON FUNCTION control_plane_ai_credits() TO wodana_app;
    GRANT EXECUTE ON FUNCTION control_plane_set_ai_model_rate(varchar, integer, numeric, numeric, numeric, boolean, boolean) TO wodana_app;
  END IF;
END $$;
