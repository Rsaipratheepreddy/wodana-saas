ALTER TABLE pre_project_design_versions
  ADD COLUMN included_client_rounds smallint;

ALTER TABLE pre_project_design_versions
  ADD CONSTRAINT pre_project_design_versions_client_rounds_check
  CHECK (included_client_rounds IS NULL OR included_client_rounds BETWEEN 0 AND 99);
