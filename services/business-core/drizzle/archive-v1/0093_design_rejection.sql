ALTER TABLE pre_project_design_versions
  DROP CONSTRAINT pre_project_design_versions_status_check;

ALTER TABLE pre_project_design_versions
  ADD CONSTRAINT pre_project_design_versions_status_check
  CHECK (status IN ('draft','internal_review','internal_approved','client_review','approved','changes_requested','rejected'));
