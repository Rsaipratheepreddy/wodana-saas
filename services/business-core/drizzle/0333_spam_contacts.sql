-- PLM-138: spam is the contact's flag, counted by source and channel.
--
-- 1. crm_parties.spam_by: who flagged the contact (spam_at, from 0148, says when). A spam contact's later messages and
--    enquiries, on any source or channel, are spam too; its enquiries are created already spam (crm_leads.spam_at,
--    from 0189), out of round-robin, the response timers, the pipeline and the conversion reports.
-- 2. Permission crm.spam.unmark (clear a wrong spam flag, with a reason the history keeps): owners and administrators.
--    New workspaces give it to those roles with every other permission.
-- 3. An index for the spam figures by source and channel.
-- crm_parties and crm_leads keep their forced RLS and tenant_isolation policy. Idempotent; never disables RLS.
ALTER TABLE crm_parties ADD COLUMN IF NOT EXISTS spam_by uuid REFERENCES users (id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_parties_spam_idx ON crm_parties (workspace_id) WHERE spam_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_leads_spam_created_idx ON crm_leads (workspace_id, created_at) WHERE spam_at IS NOT NULL;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('crm.spam.unmark', 'Clear a wrong spam flag')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE permission.code = 'crm.spam.unmark' AND role.is_system AND role.code IN ('owner', 'administrator')
ON CONFLICT (role_id, permission_id) DO NOTHING;
