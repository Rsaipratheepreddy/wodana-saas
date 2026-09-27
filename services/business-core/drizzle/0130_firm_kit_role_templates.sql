-- Firm setup kits now say which people a firm of that kind employs (role templates), so a new
-- workspace opens with Sales, Quantity Surveyor (estimator), Finance reviewer, Operations approver,
-- Project manager and, where the firm runs sites, Site supervisor roles to invite into. The templates
-- (names and permission sets) live in code (workspaces/role-templates.ts); the kit only lists which
-- apply, and a kit without the key gets all of them. Existing workspaces keep the roles they have.
-- Idempotent: only kits without the key are touched.
UPDATE tenant_setup_profiles
   SET configuration = configuration || jsonb_build_object('roleTemplates', to_jsonb(ARRAY['sales','quantity_surveyor','finance_reviewer','operations_approver','project_manager']))
 WHERE kind = 'firm_kit' AND code = 'interior_studio' AND selectable AND NOT (configuration ? 'roleTemplates');
--> statement-breakpoint
UPDATE tenant_setup_profiles
   SET configuration = configuration || jsonb_build_object('roleTemplates', to_jsonb(ARRAY['sales','quantity_surveyor','finance_reviewer','operations_approver','project_manager','site_supervisor']))
 WHERE kind = 'firm_kit' AND selectable AND NOT (configuration ? 'roleTemplates');
