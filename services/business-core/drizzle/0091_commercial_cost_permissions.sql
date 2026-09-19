INSERT INTO permissions(code,description) VALUES
  ('commercial.costs.view','View internal quotation costs and gross margin'),
  ('commercial.costs.manage','Edit internal quotation costs')
ON CONFLICT(code) DO NOTHING;

ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
INSERT INTO role_permissions(workspace_id,role_id,permission_id)
SELECT role.workspace_id,role.id,permission.id
FROM roles role CROSS JOIN permissions permission
WHERE role.is_system AND role.code IN ('owner','administrator')
  AND permission.code IN ('commercial.costs.view','commercial.costs.manage')
ON CONFLICT(role_id,permission_id) DO NOTHING;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
