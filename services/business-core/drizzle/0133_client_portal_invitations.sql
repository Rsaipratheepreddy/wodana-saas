-- Inviting a project's client to the portal. The invitation is the record that the client was told: which
-- contact (their grant), for which project, to which email, by whom, and whether the email left. The link in
-- the email carries a token (stored hashed) that opens the portal with the client's number ready; it expires,
-- and revoking access ends every open invitation. Access itself stays the grant (mobile number + code).
CREATE TABLE client_portal_invitations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  grant_id uuid NOT NULL REFERENCES client_portal_grants (id),
  project_id uuid NOT NULL,
  email varchar(254) NOT NULL,
  token_hash char(64) NOT NULL,
  delivery varchar(20) NOT NULL,
  sent_by uuid NOT NULL REFERENCES users (id),
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users (id),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CONSTRAINT client_portal_invitations_email_check CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT client_portal_invitations_delivery_check CHECK (delivery IN ('sent', 'not_configured', 'failed', 'suppressed')),
  CONSTRAINT client_portal_invitations_revoked_check CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT client_portal_invitations_expiry_check CHECK (expires_at > sent_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX client_portal_invitations_token_idx ON client_portal_invitations (token_hash);
--> statement-breakpoint
CREATE INDEX client_portal_invitations_grant_idx ON client_portal_invitations (workspace_id, grant_id, sent_at DESC);
--> statement-breakpoint
CREATE INDEX client_portal_invitations_project_idx ON client_portal_invitations (workspace_id, project_id, sent_at DESC);
--> statement-breakpoint
ALTER TABLE client_portal_invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_portal_invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON client_portal_invitations
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON client_portal_invitations TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The project's manager hears, in the app, the first time the client signs in.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'client_portal.client_signed_in', 'in_app', 'en', 1, 'approved', '{{client}} opened the client portal',
       '{{client}} signed in to the portal for {{title}} for the first time.', '["client", "title"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
