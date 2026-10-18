-- View as is for the owner only: no other role keeps `workspace.view_as` (the server refuses anyone but an owner too).
DELETE FROM role_permissions rp
 USING roles role, permissions permission
 WHERE rp.role_id = role.id AND rp.permission_id = permission.id AND permission.code = 'workspace.view_as'
   AND NOT (role.is_system AND role.code = 'owner');
