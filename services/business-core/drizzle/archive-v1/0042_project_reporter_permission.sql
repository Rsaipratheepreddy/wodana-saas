ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id) SELECT r.workspace_id,r.id,p.id FROM roles r JOIN permissions p ON p.code='projects.report' WHERE r.is_system AND r.code='member' ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
