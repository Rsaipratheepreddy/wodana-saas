INSERT INTO permissions (code, description) VALUES
  ('module.organization.read', 'Read all organization profile features'),
  ('module.organization.write', 'Create across all organization profile features'),
  ('module.organization.edit', 'Edit across all organization profile features'),
  ('module.organization.delete', 'Delete across all organization profile features'),
  ('module.members.read', 'Read all member features'),
  ('module.members.write', 'Create across all member features'),
  ('module.members.edit', 'Edit across all member features'),
  ('module.members.delete', 'Delete across all member features'),
  ('module.teams.read', 'Read all team and business unit features'),
  ('module.teams.write', 'Create across all team and business unit features'),
  ('module.teams.edit', 'Edit across all team and business unit features'),
  ('module.teams.delete', 'Delete across all team and business unit features'),
  ('module.roles.read', 'Read all role and permission features'),
  ('module.roles.write', 'Create across all role and permission features'),
  ('module.roles.edit', 'Edit across all role and permission features'),
  ('module.roles.delete', 'Delete across all role and permission features'),
  ('module.integrations.read', 'Read all integration features'),
  ('module.integrations.write', 'Create across all integration features'),
  ('module.integrations.edit', 'Edit across all integration features'),
  ('module.integrations.delete', 'Delete across all integration features')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint

INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.is_system = true
  AND role.code IN ('owner', 'administrator')
  AND permission.code LIKE 'module.%'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint

INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
FROM roles role
CROSS JOIN permissions permission
WHERE role.is_system = true
  AND role.code IN ('member', 'viewer')
  AND permission.code LIKE 'module.%.read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint

WITH permission_map (legacy_code, module_code) AS (
  VALUES
    ('workspace.settings.manage', 'module.organization.read'),
    ('workspace.settings.manage', 'module.organization.write'),
    ('workspace.settings.manage', 'module.organization.edit'),
    ('workspace.settings.manage', 'module.organization.delete'),
    ('legal_entities.view', 'module.organization.read'),
    ('legal_entities.view', 'module.teams.read'),
    ('legal_entities.manage', 'module.organization.read'),
    ('legal_entities.manage', 'module.organization.write'),
    ('legal_entities.manage', 'module.organization.edit'),
    ('legal_entities.manage', 'module.organization.delete'),
    ('legal_entities.manage', 'module.teams.read'),
    ('legal_entities.manage', 'module.teams.write'),
    ('legal_entities.manage', 'module.teams.edit'),
    ('legal_entities.manage', 'module.teams.delete'),
    ('workspace.members.manage', 'module.members.read'),
    ('workspace.members.manage', 'module.members.write'),
    ('workspace.members.manage', 'module.members.edit'),
    ('workspace.members.manage', 'module.members.delete'),
    ('workspace.roles.manage', 'module.roles.read'),
    ('workspace.roles.manage', 'module.roles.write'),
    ('workspace.roles.manage', 'module.roles.edit'),
    ('workspace.roles.manage', 'module.roles.delete'),
    ('integrations.view', 'module.integrations.read'),
    ('integrations.manage', 'module.integrations.read'),
    ('integrations.manage', 'module.integrations.write'),
    ('integrations.manage', 'module.integrations.edit'),
    ('integrations.manage', 'module.integrations.delete')
)
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT granted.workspace_id, granted.role_id, module_permission.id
FROM role_permissions granted
JOIN permissions legacy_permission ON legacy_permission.id = granted.permission_id
JOIN permission_map mapped ON mapped.legacy_code = legacy_permission.code
JOIN permissions module_permission ON module_permission.code = mapped.module_code
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
