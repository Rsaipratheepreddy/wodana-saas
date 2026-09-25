/** Shared recipient authorization. Mentioning never grants project access. */
export const projectMemberRecipientsSql=`SELECT m.id,m.id AS membership_id,m.user_id FROM workspace_memberships m
WHERE m.workspace_id=$1 AND m.status='active' AND m.id=ANY($3::uuid[]) AND (
 EXISTS(SELECT 1 FROM project_assignments a WHERE a.workspace_id=m.workspace_id AND a.project_id=$2 AND a.membership_id=m.id AND a.active)
 OR EXISTS(SELECT 1 FROM effective_member_roles r JOIN role_permissions rp ON rp.role_id=r.role_id JOIN permissions p ON p.id=rp.permission_id
 WHERE r.workspace_id=m.workspace_id AND r.membership_id=m.id AND p.code='projects.manage'))`;
