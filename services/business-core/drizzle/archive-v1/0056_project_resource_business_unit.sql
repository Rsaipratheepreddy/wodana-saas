ALTER TABLE project_resources ADD COLUMN business_unit_id uuid REFERENCES business_units(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX project_resources_business_unit_idx ON project_resources(workspace_id, business_unit_id) WHERE active;
--> statement-breakpoint
CREATE TRIGGER project_resources_business_unit_workspace_guard
BEFORE INSERT OR UPDATE ON project_resources
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('business_units', 'business_unit_id');
