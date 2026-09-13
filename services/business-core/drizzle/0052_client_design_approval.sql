ALTER TABLE pre_project_design_activity ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE pre_project_design_activity ADD COLUMN client_grant_id uuid REFERENCES client_portal_grants(id);
ALTER TABLE pre_project_design_activity ADD CONSTRAINT design_activity_actor_required
 CHECK ((created_by IS NOT NULL AND client_grant_id IS NULL) OR (created_by IS NULL AND client_grant_id IS NOT NULL AND decision_source='client_portal'));
