ALTER TABLE workspace_memberships
  ADD COLUMN home_layout jsonb,
  ADD COLUMN home_layout_version integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT workspace_memberships_home_layout_array CHECK (home_layout IS NULL OR jsonb_typeof(home_layout) = 'array'),
  ADD CONSTRAINT workspace_memberships_home_layout_version_nonnegative CHECK (home_layout_version >= 0);
