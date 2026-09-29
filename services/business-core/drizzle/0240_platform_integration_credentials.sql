-- Wodana's own application credentials for the providers firms connect to (Meta for WhatsApp, Intuit for
-- QuickBooks, Zoho, Google) and the public address their callbacks and webhooks are built from. This is
-- platform configuration, not tenant data: one row per provider, read and changed only by an active Wodana
-- operator from Wodana Control.
--
-- Secrets are write-only. They arrive sealed by the intelligence service with the key that already seals
-- firms' integration tokens (INTEGRATIONS_ENCRYPTION_KEY, which Business Core never holds), so this table
-- only ever sees ciphertext. The app role cannot select the sealed columns at all: it writes them, reads
-- "set · last 4", and hands the sealed values back only to the intelligence service, through
-- platform_integration_credentials_runtime().
CREATE TABLE platform_integration_credentials (
  provider varchar(12) PRIMARY KEY CHECK (provider IN ('platform', 'meta', 'intuit', 'zoho', 'google')),
  -- Meta: the app ID; Intuit, Zoho and Google: the OAuth client ID.
  client_id varchar(200) CHECK (client_id IS NULL OR length(btrim(client_id)) > 0),
  client_secret_sealed text,
  client_secret_last4 varchar(4),
  -- Meta: the webhook verify token; Intuit: the webhook verifier token.
  webhook_secret_sealed text,
  webhook_secret_last4 varchar(4),
  -- Meta: the Embedded Signup (Facebook Login for Business) configuration and the Graph API version.
  config_id varchar(40) CHECK (config_id IS NULL OR config_id ~ '^[0-9]{5,40}$'),
  graph_version varchar(8) CHECK (graph_version IS NULL OR graph_version ~ '^v[0-9]{1,2}\.[0-9]$'),
  -- Intuit: sandbox or production.
  environment varchar(12) CHECK (environment IS NULL OR environment IN ('sandbox', 'production')),
  -- Zoho: the data center the app is registered in.
  data_center varchar(4) CHECK (data_center IS NULL OR data_center IN ('us', 'in', 'eu', 'au', 'ca', 'jp', 'sa')),
  -- Platform: the public origin of the integration API (callback and webhook URLs are built from it).
  public_api_base varchar(200) CHECK (public_api_base IS NULL OR public_api_base ~ '^https?://[^/?#[:space:]]+$'),
  test_status varchar(8) NOT NULL DEFAULT 'untested' CHECK (test_status IN ('untested', 'passed', 'failed')),
  test_reason varchar(40) CHECK (test_reason IS NULL OR test_reason ~ '^[a-z_]{2,40}$'),
  tested_at timestamptz,
  tested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  -- The request key of the last change: a retried save lands once.
  last_request_key varchar(160),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_integration_credentials_secret_hint CHECK (
    (client_secret_sealed IS NULL) = (client_secret_last4 IS NULL)
    AND (webhook_secret_sealed IS NULL) = (webhook_secret_last4 IS NULL)
  ),
  CONSTRAINT platform_integration_credentials_tested CHECK (
    (test_status = 'untested' AND tested_at IS NULL AND test_reason IS NULL)
    OR (test_status = 'passed' AND tested_at IS NOT NULL AND test_reason IS NULL)
    OR (test_status = 'failed' AND tested_at IS NOT NULL AND test_reason IS NOT NULL)
  ),
  -- Each provider keeps only its own fields.
  CONSTRAINT platform_integration_credentials_fields CHECK (
    (provider = 'platform' AND client_id IS NULL AND client_secret_sealed IS NULL AND webhook_secret_sealed IS NULL
      AND config_id IS NULL AND graph_version IS NULL AND environment IS NULL AND data_center IS NULL)
    OR (provider = 'meta' AND environment IS NULL AND data_center IS NULL AND public_api_base IS NULL)
    OR (provider = 'intuit' AND config_id IS NULL AND graph_version IS NULL AND data_center IS NULL AND public_api_base IS NULL)
    OR (provider = 'zoho' AND webhook_secret_sealed IS NULL AND config_id IS NULL AND graph_version IS NULL
      AND environment IS NULL AND public_api_base IS NULL)
    OR (provider = 'google' AND webhook_secret_sealed IS NULL AND config_id IS NULL AND graph_version IS NULL
      AND environment IS NULL AND data_center IS NULL AND public_api_base IS NULL)
  )
);
--> statement-breakpoint
INSERT INTO platform_integration_credentials (provider) VALUES ('platform'), ('meta'), ('intuit'), ('zoho'), ('google');
--> statement-breakpoint
ALTER TABLE platform_integration_credentials ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_integration_credentials FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_operator_access ON platform_integration_credentials
  USING (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_administrators operator
    WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'));
--> statement-breakpoint

-- A change applies to every firm at once, so the other operators who manage these credentials are told in
-- Wodana Control (an in-app notice added by the operator who made the change).
CREATE POLICY platform_integration_changed ON platform_operator_notifications FOR INSERT
  WITH CHECK (event_type = 'platform_integration.changed' AND source_type = 'platform_integration' AND read_at IS NULL
    AND EXISTS (SELECT 1 FROM platform_administrators operator
      WHERE operator.user_id = NULLIF(current_setting('app.current_actor_id', true), '')::uuid AND operator.status = 'active'));
--> statement-breakpoint

-- The intelligence service's read, through Business Core's internal endpoint: every provider's values with
-- the secrets still sealed. Nothing here can open them.
CREATE FUNCTION platform_integration_credentials_runtime()
RETURNS TABLE (
  provider varchar, client_id varchar, client_secret_sealed text, webhook_secret_sealed text, config_id varchar,
  graph_version varchar, environment varchar, data_center varchar, public_api_base varchar, version integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT credential.provider, credential.client_id, credential.client_secret_sealed, credential.webhook_secret_sealed,
         credential.config_id, credential.graph_version, credential.environment, credential.data_center,
         credential.public_api_base, credential.version
    FROM platform_integration_credentials credential
   ORDER BY credential.provider
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_integration_credentials_runtime() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- Everything but the sealed secrets is readable (by an operator, under the policy above) ...
    GRANT SELECT (provider, client_id, client_secret_last4, webhook_secret_last4, config_id, graph_version, environment,
      data_center, public_api_base, test_status, test_reason, tested_at, tested_by, last_request_key, version, updated_by,
      created_at, updated_at) ON platform_integration_credentials TO wodana_app;
    -- ... and the sealed secrets are write-only. Rows are fixed: no inserts or deletes.
    GRANT UPDATE (client_id, client_secret_sealed, client_secret_last4, webhook_secret_sealed, webhook_secret_last4,
      config_id, graph_version, environment, data_center, public_api_base, test_status, test_reason, tested_at, tested_by,
      last_request_key, version, updated_by, updated_at) ON platform_integration_credentials TO wodana_app;
    GRANT EXECUTE ON FUNCTION platform_integration_credentials_runtime() TO wodana_app;
  END IF;
END $$;
