-- Sales records an offline acceptance (Q-24). A client often accepts on WhatsApp or by returning a signed PDF.
-- `commercial.record_decision` lets Sales record it (with how, and the file it came in); the case's owner can
-- too without it. Approvers keep recording with commercial.approve. Owners and administrators get it like every
-- permission; the kit's Sales role gets it (role-templates.ts). Idempotent.
INSERT INTO permissions (code, description) VALUES
  ('commercial.record_decision', 'Record a client''s decision on a quote, with evidence')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE ((role.is_system AND role.code IN ('owner', 'administrator')) OR (NOT role.is_system AND role.code = 'sales'))
   AND permission.code = 'commercial.record_decision'
ON CONFLICT (role_id, permission_id) DO NOTHING;
