-- Inbox visibility (plan §5b, §6.5a) and "File into job".
--   * Levels, read from the permissions a role holds, never from its name:
--       Own chats   crm.communications.view + crm.communications.send: the unfiled chats assigned to me;
--       Team chats  + crm.inbox.team: the unassigned intake queue, mine and my queue mates' (the Sales admin team);
--       Manage      + crm.inbox.manage (or crm.settings.manage): every chat and the inbox settings.
--     A chat filed into a job is seen by that job's team (the enquiry's owner, the opportunity's owner and team,
--     the project's active assignments) whatever their level; leaving the team hides it again (E6-4).
--   * Defaults for existing roles:
--       - owner, administrator and roles that run CRM settings → Manage;
--       - roles that can change a client's identity (crm.parties.identity: the Sales admins, 0245) → Team chats;
--       - every other role that can open the inbox → Own chats (it can now answer its own chats);
--       - roles that hold the inbox but do no sales work (no enquiries, opportunities or CRM settings) lose the
--         Inbox; they still see the chats filed into their own jobs.
--   * crm_conversations.job_kind/job_id: the enquiry, opportunity or project a chat is filed into. A chat already
--     linked to an enquiry is filed into it. History lines 'filed' / 'unfiled'.
--   * crm.inbox_filed: the in-app notice a job's owner gets when a chat is filed into their job.
-- No table is created. Every statement is idempotent (re-running leaves the same state), and the migration runs
-- as the migration owner, so forced RLS is never disabled.
INSERT INTO permissions (code, description) VALUES
  ('crm.inbox.team', 'See the unassigned queue and the team''s chats'),
  ('crm.inbox.manage', 'See every chat and manage the inbox')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
-- Manage: owner and administrator, and any role that runs CRM settings.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE permission.code IN ('crm.communications.view', 'crm.communications.send', 'crm.inbox.team', 'crm.inbox.manage')
   AND ((role.is_system AND role.code IN ('owner', 'administrator'))
     OR (NOT role.is_system AND EXISTS (
       SELECT 1 FROM role_permissions held JOIN permissions settings ON settings.id = held.permission_id
        WHERE held.role_id = role.id AND settings.code = 'crm.settings.manage')))
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- Team chats: roles that open the inbox and may change a client's identity (the Sales admins).
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE NOT role.is_system
   AND permission.code IN ('crm.communications.send', 'crm.inbox.team')
   AND EXISTS (SELECT 1 FROM role_permissions held JOIN permissions inbox ON inbox.id = held.permission_id
                WHERE held.role_id = role.id AND inbox.code = 'crm.communications.view')
   AND EXISTS (SELECT 1 FROM role_permissions held JOIN permissions admin ON admin.id = held.permission_id
                WHERE held.role_id = role.id AND admin.code = 'crm.parties.identity')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
-- No Inbox for roles with no sales work (designers, project managers, factory…). Idempotent: it removes only
-- inbox codes, only from editable roles that hold none of the sales codes, so a second run finds nothing.
DELETE FROM role_permissions held
 USING roles role, permissions permission
 WHERE held.role_id = role.id AND held.permission_id = permission.id
   AND NOT role.is_system
   AND permission.code IN ('crm.communications.view', 'crm.communications.send', 'crm.inbox.team', 'crm.inbox.manage')
   AND NOT EXISTS (SELECT 1 FROM role_permissions sales JOIN permissions code ON code.id = sales.permission_id
                    WHERE sales.role_id = role.id AND code.code IN ('crm.leads.view', 'crm.leads.manage', 'crm.opportunities.manage', 'crm.settings.manage'));
--> statement-breakpoint
-- Own chats: whoever can still open the inbox can answer their own chats.
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE permission.code = 'crm.communications.send'
   AND EXISTS (SELECT 1 FROM role_permissions held JOIN permissions inbox ON inbox.id = held.permission_id
                WHERE held.role_id = role.id AND inbox.code = 'crm.communications.view')
ON CONFLICT (role_id, permission_id) DO NOTHING;
--> statement-breakpoint
ALTER TABLE crm_conversations ADD COLUMN IF NOT EXISTS job_kind varchar(20);
--> statement-breakpoint
ALTER TABLE crm_conversations ADD COLUMN IF NOT EXISTS job_id uuid;
--> statement-breakpoint
ALTER TABLE crm_conversations ADD COLUMN IF NOT EXISTS filed_at timestamptz;
--> statement-breakpoint
ALTER TABLE crm_conversations ADD COLUMN IF NOT EXISTS filed_by uuid;
--> statement-breakpoint
ALTER TABLE crm_conversations DROP CONSTRAINT IF EXISTS crm_conversations_job_check;
--> statement-breakpoint
ALTER TABLE crm_conversations ADD CONSTRAINT crm_conversations_job_check
  CHECK ((job_kind IS NULL AND job_id IS NULL) OR (job_kind IN ('enquiry', 'opportunity', 'project') AND job_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_conversations_job_idx ON crm_conversations (workspace_id, job_kind, job_id) WHERE job_id IS NOT NULL;
--> statement-breakpoint
-- Chats already linked to an enquiry are filed into it.
UPDATE crm_conversations SET job_kind = 'enquiry', job_id = lead_id, filed_at = COALESCE(filed_at, updated_at)
 WHERE lead_id IS NOT NULL AND job_id IS NULL;
--> statement-breakpoint
ALTER TABLE crm_conversation_events DROP CONSTRAINT IF EXISTS crm_conversation_events_kind_check;
--> statement-breakpoint
ALTER TABLE crm_conversation_events ADD CONSTRAINT crm_conversation_events_kind_check CHECK (kind IN (
  'resolved', 'reopened', 'snoozed', 'woke', 'assigned', 'unassigned', 'labelled', 'unlabelled', 'linked', 'blocked', 'unblocked', 'hidden', 'unhidden', 'filed', 'unfiled'));
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.inbox_filed', 'in_app', 'en', 1, 'approved',
  'A chat with {{clientName}} is in {{job}}',
  '{{actor}} filed it into your job. New messages from them reach you here.',
  '["clientName","job","actor"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
