-- AI apps through MCP (W-5). An AI app (Claude Desktop, …) registers itself (RFC 7591), a person signs in to
-- Wodana and allows it for one workspace, and the app then calls Woddy's tools as that person with a
-- short-lived access token and a rotating refresh token (OAuth 2.1, PKCE). What it may do is the person's own
-- permissions, narrowed to the scopes they allowed (read, write) and to workspaces that switched AI apps on.
-- Writes are never direct: they become proposed Woddy actions (ai_tool_calls) the person confirms.
--
-- Only hashes of codes, tokens and client secrets are stored. App registrations are platform-level (the same
-- app connects to many workspaces); everything a person granted in a workspace is tenant data under forced RLS.

-- The workspace's switch for AI apps: off until an owner turns it on (the AI switch must be on too).
ALTER TABLE workspace_ai_settings ADD COLUMN mcp_enabled boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- A tool call from an AI app is a run of its own (no model turn: rounds and tokens stay 0).
ALTER TABLE ai_agent_runs DROP CONSTRAINT ai_agent_runs_surface_check;
--> statement-breakpoint
ALTER TABLE ai_agent_runs ADD CONSTRAINT ai_agent_runs_surface_check CHECK (surface IN ('panel', 'inbox', 'comment', 'search', 'mcp'));
--> statement-breakpoint
CREATE TABLE mcp_oauth_clients (
  -- The client_id the app uses.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name varchar(120) NOT NULL,
  client_uri varchar(500),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 10),
  token_endpoint_auth_method varchar(30) NOT NULL DEFAULT 'none'
    CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
  client_secret_hash char(64),
  software_id varchar(200),
  software_version varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_oauth_clients_secret_check CHECK ((token_endpoint_auth_method = 'none') = (client_secret_hash IS NULL))
);
--> statement-breakpoint
-- One app allowed by one person in one workspace, with what they allowed. Revoking it ends every token.
CREATE TABLE mcp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  client_id uuid NOT NULL REFERENCES mcp_oauth_clients (id),
  client_name varchar(120) NOT NULL,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read', 'write']::text[] AND 'read' = ANY (scopes)),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users (id),
  -- Who ended it: the person, an owner, the app itself (token revocation), or a reused code or refresh token.
  revoke_reason varchar(20) CHECK (revoke_reason IN ('person', 'manager', 'app', 'token_reuse')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT mcp_connections_revoked_check CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX mcp_connections_active_idx ON mcp_connections (workspace_id, user_id, client_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX mcp_connections_recent_idx ON mcp_connections (workspace_id, created_at DESC);
--> statement-breakpoint
-- A one-time authorization code (10 minutes), bound to the redirect URI, the PKCE challenge and the resource.
CREATE TABLE mcp_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  code_hash char(64) NOT NULL UNIQUE,
  redirect_uri text NOT NULL,
  code_challenge varchar(128) NOT NULL,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read', 'write']::text[] AND 'read' = ANY (scopes)),
  resource varchar(500) NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES mcp_connections (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT mcp_authorization_codes_expiry_check CHECK (expires_at > created_at)
);
--> statement-breakpoint
-- Access tokens (1 hour) and refresh tokens (30 days, replaced on every use: a used one presented again ends
-- the connection).
CREATE TABLE mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('access', 'refresh')),
  token_hash char(64) NOT NULL UNIQUE,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read', 'write']::text[] AND 'read' = ANY (scopes)),
  resource varchar(500) NOT NULL,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, connection_id) REFERENCES mcp_connections (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT mcp_tokens_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT mcp_tokens_rotation_check CHECK (rotated_at IS NULL OR kind = 'refresh')
);
--> statement-breakpoint
CREATE INDEX mcp_tokens_connection_idx ON mcp_tokens (workspace_id, connection_id, kind) WHERE revoked_at IS NULL;
--> statement-breakpoint
-- Tool calls per connection per minute, when Redis is not there to count them.
CREATE TABLE mcp_rate_windows (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (workspace_id, connection_id, window_start)
);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['mcp_connections', 'mcp_authorization_codes', 'mcp_tokens', 'mcp_rate_windows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    -- Registrations are kept; connections, codes and tokens change state (used, rotated, revoked), never deleted.
    GRANT SELECT, INSERT ON mcp_oauth_clients TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON mcp_connections TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON mcp_authorization_codes TO wodana_app;
    GRANT SELECT, INSERT, UPDATE ON mcp_tokens TO wodana_app;
    -- Old minute windows are cleared as new ones are counted.
    GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_rate_windows TO wodana_app;
  END IF;
END $$;
