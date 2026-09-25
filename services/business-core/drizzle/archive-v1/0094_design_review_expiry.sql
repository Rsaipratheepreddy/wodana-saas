ALTER TABLE pre_project_design_versions
  ADD COLUMN client_review_expires_at timestamptz;

CREATE INDEX pre_project_design_versions_review_expiry_idx
  ON pre_project_design_versions(workspace_id, status, client_review_expires_at)
  WHERE status = 'client_review';

