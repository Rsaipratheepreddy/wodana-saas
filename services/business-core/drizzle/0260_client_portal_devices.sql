-- P4 batch 2 — the client mobile app (plan §0.3c, §6.22, §6.24): a client contact's phones for push notices.
--   * client_portal_devices: one row per app install of a signed-in client number. Written only after the client said
--     yes in the app (consented_at) and the phone allowed notifications; the push token itself lives in the secure token
--     store (encrypted_token_reference), only its hash here. Turning notices off on the phone keeps the row with
--     opted_out_at set, so the opt-out is remembered and nothing is sent. A device is reached only while the session it
--     was registered under is live: signing out, staff ending the contact's sessions or removing their access stops it.
-- workspace_id, forced RLS and the tenant_isolation policy. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS client_portal_devices (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  phone varchar(16) NOT NULL,
  session_id uuid NOT NULL REFERENCES client_portal_sessions (id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  platform varchar(10) NOT NULL CHECK (platform IN ('ios', 'android')),
  token_type varchar(10) NOT NULL DEFAULT 'expo' CHECK (token_type = 'expo'),
  token_hash varchar(64),
  encrypted_token_reference varchar(500),
  locale varchar(35) NOT NULL,
  timezone varchar(64) NOT NULL,
  consented_at timestamptz NOT NULL,
  opted_out_at timestamptz,
  last_request_id uuid NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, phone, installation_id),
  -- An opted-out phone holds no token.
  CHECK (opted_out_at IS NULL OR (token_hash IS NULL AND encrypted_token_reference IS NULL)),
  CHECK ((token_hash IS NULL) = (encrypted_token_reference IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_devices_token_uidx ON client_portal_devices (workspace_id, token_hash) WHERE token_hash IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS client_portal_devices_phone_idx ON client_portal_devices (workspace_id, phone) WHERE opted_out_at IS NULL;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE client_portal_devices ENABLE ROW LEVEL SECURITY;
  ALTER TABLE client_portal_devices FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'client_portal_devices' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON client_portal_devices
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- A phone's row is kept (opt-out is remembered); a token another install now holds is removed from the old row.
    GRANT SELECT, INSERT, UPDATE, DELETE ON client_portal_devices TO wodana_app;
  END IF;
END $$;
