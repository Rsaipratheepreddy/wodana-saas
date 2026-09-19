CREATE TABLE notification_device_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  last_request_id uuid NOT NULL,
  platform varchar(30) NOT NULL,
  permission_status varchar(30) NOT NULL,
  locale varchar(35) NOT NULL,
  timezone varchar(64) NOT NULL,
  permission_updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  UNIQUE(workspace_id,user_id,installation_id),
  CHECK(platform IN ('ios','android')),
  CHECK(permission_status IN ('undetermined','denied','granted','provisional','ephemeral')),
  CHECK(length(trim(locale)) > 0),
  CHECK(length(trim(timezone)) > 0),
  CHECK(version > 0)
);

ALTER TABLE device_endpoints ADD COLUMN installation_id uuid;
ALTER TABLE device_endpoints ADD COLUMN token_type varchar(20) NOT NULL DEFAULT 'expo';
ALTER TABLE device_endpoints ADD COLUMN consent_id uuid REFERENCES notification_device_consents(id) ON DELETE SET NULL;
ALTER TABLE device_endpoints ADD COLUMN last_request_id uuid;
UPDATE device_endpoints SET installation_id=gen_random_uuid() WHERE installation_id IS NULL;
UPDATE device_endpoints SET last_request_id=gen_random_uuid() WHERE last_request_id IS NULL;
ALTER TABLE device_endpoints ALTER COLUMN installation_id SET NOT NULL;
ALTER TABLE device_endpoints ALTER COLUMN last_request_id SET NOT NULL;
ALTER TABLE device_endpoints ADD CONSTRAINT device_endpoints_platform_check CHECK(platform IN ('ios','android'));
ALTER TABLE device_endpoints ADD CONSTRAINT device_endpoints_token_type_check CHECK(token_type='expo');
CREATE UNIQUE INDEX device_endpoints_installation_uidx ON device_endpoints(workspace_id,user_id,installation_id);

ALTER TABLE notification_delivery_attempts ADD COLUMN destination_reference varchar(500);

ALTER TABLE notification_device_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_device_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_device_consents
  USING (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK (workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT,UPDATE ON notification_device_consents TO wodana_app;
  END IF;
END $$;
