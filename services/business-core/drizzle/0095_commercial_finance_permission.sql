INSERT INTO permissions(code, description)
VALUES (
  'commercial.finance.verify',
  'Verify commercial receipts, allocations and client credit records'
)
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;

INSERT INTO role_permissions(workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'commercial.finance.verify'
WHERE role.is_system = true
  AND role.code IN ('owner', 'administrator')
ON CONFLICT(role_id, permission_id) DO NOTHING;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
