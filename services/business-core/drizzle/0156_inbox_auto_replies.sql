-- Auto replies: a greeting for a client's first message (or the first after a quiet spell) and an away message
-- outside business hours. One row holds the workspace's settings (connection_id is null); a WhatsApp number may
-- have its own row, which then replaces the workspace's for messages to that number. Hours left null follow the
-- workspace: its work calendar (else the region pack's working week) and its time zone.
CREATE TABLE crm_auto_reply_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connection_id uuid REFERENCES integration_connections (id) ON DELETE CASCADE,
  greeting_enabled boolean NOT NULL DEFAULT false,
  greeting_text text NOT NULL,
  greeting_silence_days smallint NOT NULL DEFAULT 14,
  away_enabled boolean NOT NULL DEFAULT false,
  away_text text NOT NULL,
  away_window_hours smallint NOT NULL DEFAULT 12,
  working_days smallint[],
  day_start time,
  day_end time,
  time_zone varchar(64),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_auto_reply_settings_greeting_text_check CHECK (length(greeting_text) <= 1024 AND (NOT greeting_enabled OR length(btrim(greeting_text)) > 0)),
  CONSTRAINT crm_auto_reply_settings_away_text_check CHECK (length(away_text) <= 1024 AND (NOT away_enabled OR length(btrim(away_text)) > 0)),
  CONSTRAINT crm_auto_reply_settings_silence_check CHECK (greeting_silence_days BETWEEN 1 AND 365),
  CONSTRAINT crm_auto_reply_settings_window_check CHECK (away_window_hours BETWEEN 1 AND 168),
  CONSTRAINT crm_auto_reply_settings_days_check CHECK (working_days IS NULL OR (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[])),
  CONSTRAINT crm_auto_reply_settings_hours_check CHECK ((day_start IS NULL) = (day_end IS NULL) AND (day_start IS NULL OR day_start <> day_end)),
  CONSTRAINT crm_auto_reply_settings_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_auto_reply_settings_scope_uidx ON crm_auto_reply_settings
  (workspace_id, COALESCE(connection_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
-- Each auto reply sent, once per client message (the inbound message is the idempotency key); the away message's
-- "once per chat per window" reads it.
CREATE TABLE crm_auto_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  inbound_message_id uuid NOT NULL REFERENCES crm_messages (id) ON DELETE CASCADE,
  reply_message_id uuid REFERENCES crm_messages (id) ON DELETE SET NULL,
  kind varchar(20) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES crm_conversations (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT crm_auto_replies_inbound_key UNIQUE (workspace_id, inbound_message_id),
  CONSTRAINT crm_auto_replies_kind_check CHECK (kind IN ('greeting', 'away'))
);
--> statement-breakpoint
CREATE INDEX crm_auto_replies_conversation_idx ON crm_auto_replies (workspace_id, conversation_id, kind, created_at DESC);
--> statement-breakpoint
ALTER TABLE crm_auto_reply_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_auto_reply_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_auto_reply_settings
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE crm_auto_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_auto_replies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_auto_replies
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm_auto_reply_settings TO wodana_app;
    GRANT SELECT, INSERT ON crm_auto_replies TO wodana_app;
  END IF;
END $$;
