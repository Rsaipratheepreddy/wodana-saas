-- Item 2: Factory Approval Permission Split (18 Oct 2026).
-- Granular separation of the unified factory.approve permission into:
-- (a) factory.recipe.verify: Verify factory recipes, custom line requirements, and material substitutions
-- (b) factory.dispatch.signoff: Sign off production output, quality inspections, check photos, and dispatch/ready dates
-- Existing system roles (owner, administrator) and any custom/template role currently holding factory.approve
-- receive both new permissions to maintain full backward compatibility.
INSERT INTO permissions (code, description) VALUES
  ('factory.recipe.verify', 'Verify factory recipes, custom requirements, and material substitutions'),
  ('factory.dispatch.signoff', 'Sign off production output, quality checks, and dispatch dates')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role
  CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator')
   AND permission.code IN ('factory.recipe.verify', 'factory.dispatch.signoff')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT existing.workspace_id, existing.role_id, new_perm.id
  FROM role_permissions existing
  JOIN permissions old_perm ON old_perm.id = existing.permission_id AND old_perm.code = 'factory.approve'
  CROSS JOIN permissions new_perm
 WHERE new_perm.code IN ('factory.recipe.verify', 'factory.dispatch.signoff')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
UPDATE tenant_setup_profiles
   SET configuration = jsonb_set(
     configuration,
     '{roleTemplates}',
     (
       SELECT jsonb_agg(
         CASE
           WHEN role->>'code' = 'factory_lead' THEN
             jsonb_set(role, '{permissions}', (role->'permissions') || '["factory.recipe.verify", "factory.dispatch.signoff"]'::jsonb)
           WHEN role->>'code' = 'qc_inspector' THEN
             jsonb_set(role, '{permissions}', (role->'permissions') || '["factory.dispatch.signoff"]'::jsonb)
           ELSE role
         END
       )
       FROM jsonb_array_elements(configuration->'roleTemplates') role
     )
   )
 WHERE kind = 'firm_kit' AND jsonb_typeof(configuration->'roleTemplates') = 'array';
