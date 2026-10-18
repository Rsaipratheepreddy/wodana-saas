-- Each person's look inside a workspace: an uploaded photo or one of the drawn default avatars.
CREATE TABLE workspace_member_profiles (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  avatar_preset varchar(8) CHECK (avatar_preset IS NULL OR avatar_preset ~ '^[ab](0[1-9]|10)$'),
  photo_object_key text,
  photo_updated_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CHECK ((photo_object_key IS NULL) = (photo_updated_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE workspace_member_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace_member_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workspace_member_profiles
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_member_profiles TO wodana_app;
  END IF;
END $$;
