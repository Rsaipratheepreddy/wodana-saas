ALTER TABLE pre_project_design_folders ADD COLUMN reviewer_id uuid REFERENCES users(id), ADD COLUMN approved_versions jsonb, ADD COLUMN approved_at timestamptz;
