-- Team inbox: a chat is Open, Snoozed (comes back at a time) or Resolved ('closed'); it has an owner, labels and a
-- wait clock (the oldest client message we have not answered). Assignment, state changes and labels are kept as
-- rows in crm_conversation_events, which the thread shows as system lines. Labels, quick replies, the inbox
-- settings and the WhatsApp template variable mapping are workspace configuration tables.
ALTER TABLE crm_conversations
  ADD COLUMN snoozed_until timestamptz,
  ADD COLUMN waiting_since timestamptz,
  ADD COLUMN assigned_at timestamptz,
  ADD COLUMN resolved_at timestamptz;
--> statement-breakpoint
UPDATE crm_conversations SET status = 'closed' WHERE status NOT IN ('open', 'closed');
--> statement-breakpoint
ALTER TABLE crm_conversations
  ADD CONSTRAINT crm_conversations_status_check CHECK (status IN ('open', 'snoozed', 'closed')),
  ADD CONSTRAINT crm_conversations_snooze_check CHECK ((status = 'snoozed') = (snoozed_until IS NOT NULL));
--> statement-breakpoint
-- The wait starts at the oldest client message after our last reply.
UPDATE crm_conversations conversation SET waiting_since = waiting.first_unanswered
  FROM (
    SELECT inbound.workspace_id, inbound.conversation_id, min(inbound.created_at) AS first_unanswered
      FROM crm_messages inbound
     WHERE inbound.direction = 'inbound'
       AND inbound.created_at > COALESCE((
         SELECT max(reply.created_at) FROM crm_messages reply
          WHERE reply.workspace_id = inbound.workspace_id AND reply.conversation_id = inbound.conversation_id
            AND reply.direction = 'outbound'), '-infinity'::timestamptz)
     GROUP BY inbound.workspace_id, inbound.conversation_id
  ) waiting
 WHERE conversation.workspace_id = waiting.workspace_id AND conversation.id = waiting.conversation_id;
--> statement-breakpoint
UPDATE crm_conversations SET resolved_at = updated_at WHERE status = 'closed' AND resolved_at IS NULL;
--> statement-breakpoint
UPDATE crm_conversations SET assigned_at = updated_at WHERE owner_membership_id IS NOT NULL AND assigned_at IS NULL;
--> statement-breakpoint
CREATE INDEX crm_conversations_waiting_idx ON crm_conversations (workspace_id, status, waiting_since, last_message_at DESC);
--> statement-breakpoint
CREATE INDEX crm_conversations_snoozed_idx ON crm_conversations (snoozed_until) WHERE status = 'snoozed';
--> statement-breakpoint
CREATE UNIQUE INDEX crm_conversations_workspace_id_key ON crm_conversations (workspace_id, id);
--> statement-breakpoint
CREATE TABLE crm_conversation_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name varchar(60) NOT NULL,
  color varchar(12) NOT NULL DEFAULT 'viz-1',
  status varchar(20) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_conversation_labels_workspace_id_key UNIQUE (workspace_id, id),
  CONSTRAINT crm_conversation_labels_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  CONSTRAINT crm_conversation_labels_color_check CHECK (color IN ('viz-1', 'viz-2', 'viz-3', 'viz-4', 'viz-5', 'viz-6')),
  CONSTRAINT crm_conversation_labels_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT crm_conversation_labels_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_conversation_labels_name_uidx ON crm_conversation_labels (workspace_id, lower(btrim(name))) WHERE status = 'active';
--> statement-breakpoint
CREATE TABLE crm_conversation_label_links (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  label_id uuid NOT NULL,
  added_by uuid REFERENCES users (id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, conversation_id, label_id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES crm_conversations (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, label_id) REFERENCES crm_conversation_labels (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX crm_conversation_label_links_label_idx ON crm_conversation_label_links (workspace_id, label_id);
--> statement-breakpoint
-- A quick reply belongs to the workspace (owner_membership_id is null) or to one person.
CREATE TABLE crm_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  owner_membership_id uuid REFERENCES workspace_memberships (id) ON DELETE CASCADE,
  shortcut varchar(40) NOT NULL,
  body text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_quick_replies_shortcut_check CHECK (length(shortcut) BETWEEN 1 AND 40 AND shortcut !~ '\s' AND shortcut = lower(shortcut)),
  CONSTRAINT crm_quick_replies_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 4096),
  CONSTRAINT crm_quick_replies_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT crm_quick_replies_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_quick_replies_shortcut_uidx ON crm_quick_replies
  (workspace_id, COALESCE(owner_membership_id, '00000000-0000-0000-0000-000000000000'::uuid), shortcut) WHERE status = 'active';
--> statement-breakpoint
CREATE TABLE crm_inbox_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  auto_assign boolean NOT NULL DEFAULT true,
  queue_id uuid REFERENCES crm_queues (id) ON DELETE SET NULL,
  signature_enabled boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_inbox_settings_version_check CHECK (version > 0)
);
--> statement-breakpoint
-- What fills each {{n}} of an approved WhatsApp template, by template code (it survives re-syncs).
CREATE TABLE crm_template_variables (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  channel varchar(40) NOT NULL DEFAULT 'whatsapp',
  template_code varchar(100) NOT NULL,
  position smallint NOT NULL,
  source varchar(40) NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, channel, template_code, position),
  CONSTRAINT crm_template_variables_position_check CHECK (position BETWEEN 1 AND 20),
  CONSTRAINT crm_template_variables_source_check CHECK (source IN (
    'contact.first_name', 'contact.name', 'enquiry.reference', 'opportunity.reference', 'project.name',
    'quote.number', 'invoice.number', 'invoice.total', 'portal.link', 'staff.first_name', 'business.name', 'today.date'))
);
--> statement-breakpoint
-- The chat's own history: who resolved, snoozed, assigned or labelled it and when. Append-only.
CREATE TABLE crm_conversation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  kind varchar(30) NOT NULL,
  actor_user_id uuid REFERENCES users (id),
  owner_membership_id uuid REFERENCES workspace_memberships (id) ON DELETE SET NULL,
  previous_owner_membership_id uuid REFERENCES workspace_memberships (id) ON DELETE SET NULL,
  label_id uuid,
  lead_id uuid REFERENCES crm_leads (id) ON DELETE SET NULL,
  snoozed_until timestamptz,
  method varchar(40),
  reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES crm_conversations (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, label_id) REFERENCES crm_conversation_labels (workspace_id, id),
  CONSTRAINT crm_conversation_events_kind_check CHECK (kind IN (
    'resolved', 'reopened', 'snoozed', 'woke', 'assigned', 'unassigned', 'labelled', 'unlabelled', 'linked')),
  CONSTRAINT crm_conversation_events_method_check CHECK (method IS NULL OR method IN (
    'manual', 'bulk', 'relationship', 'queue', 'client_replied', 'schedule', 'enquiry'))
);
--> statement-breakpoint
CREATE INDEX crm_conversation_events_conversation_idx ON crm_conversation_events (workspace_id, conversation_id, created_at);
--> statement-breakpoint
-- Positional values for a parameterised provider template ({{1}}, {{2}}…), an immutable snapshot of what was sent.
ALTER TABLE notifications ADD COLUMN template_parameters text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
-- A provider that has accepted a message but not yet confirmed delivery (WhatsApp): the delivered and read receipts follow.
ALTER TYPE notification_status ADD VALUE IF NOT EXISTS 'sent' AFTER 'processing';
--> statement-breakpoint
ALTER TABLE crm_conversation_labels ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_conversation_labels FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_conversation_labels
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE crm_conversation_label_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_conversation_label_links FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_conversation_label_links
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE crm_quick_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_quick_replies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_quick_replies
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE crm_inbox_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_inbox_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_inbox_settings
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE crm_template_variables ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_template_variables FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_template_variables
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE crm_conversation_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_conversation_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_conversation_events
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON crm_conversation_labels, crm_quick_replies, crm_inbox_settings TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm_conversation_label_links, crm_template_variables TO wodana_app;
    GRANT SELECT, INSERT ON crm_conversation_events TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The worker also wakes snoozed chats whose time has come.
CREATE OR REPLACE FUNCTION public.list_crm_workspaces_with_due_work() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT due.workspace_id
  FROM (
    SELECT notification.workspace_id FROM notifications notification
      WHERE (notification.status IN ('pending','scheduled') AND notification.scheduled_for <= now())
         OR (notification.status = 'processing' AND notification.processing_started_at < now() - interval '5 minutes')
    UNION ALL
    SELECT wait.workspace_id FROM automation_waits wait
      WHERE (wait.status = 'waiting' AND wait.due_at <= now())
         OR (wait.status = 'claimed' AND wait.claimed_at < now() - interval '5 minutes')
    UNION ALL
    SELECT sla.workspace_id FROM crm_sla_instances sla
      WHERE (sla.status = 'active' AND (sla.warning_at <= now() OR sla.due_at <= now()))
         OR (sla.status = 'warning' AND sla.due_at <= now())
    UNION ALL
    SELECT lead.workspace_id FROM crm_leads lead
      WHERE lead.ownership_due_at <= now() AND lead.owner_membership_id IS NOT NULL
        AND lead.status IN ('new','attempting_contact','connected','nurturing')
    UNION ALL
    SELECT enrollment.workspace_id
      FROM crm_sequence_enrollments enrollment
      JOIN crm_sequences sequence
        ON sequence.workspace_id = enrollment.workspace_id
       AND sequence.id = enrollment.sequence_id
      WHERE enrollment.status = 'active'
        AND enrollment.next_run_at <= now()
        AND sequence.status = 'active'
    UNION ALL
    SELECT conversation.workspace_id FROM crm_conversations conversation
      WHERE conversation.status = 'snoozed' AND conversation.snoozed_until <= now()
  ) due;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_crm_workspaces_with_due_work() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION public.list_crm_workspaces_with_due_work() TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Staff notices: a client wrote (one per chat until it is read), a chat is yours, a snoozed chat is back,
-- and nobody could take a new chat.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
  FROM workspaces workspace
 CROSS JOIN (VALUES
   ('crm.inbox_message', 'in_app', '{{clientName}} wrote', '{{summary}}', '["clientName","summary"]'),
   ('crm.inbox_message', 'push', '{{clientName}} wrote', '{{summary}}', '["clientName","summary"]'),
   ('crm.inbox_assigned', 'in_app', 'Chat with {{clientName}} is yours', '{{reason}}', '["clientName","reason"]'),
   ('crm.inbox_assigned', 'push', 'Chat with {{clientName}} is yours', '{{reason}}', '["clientName","reason"]'),
   ('crm.inbox_woke', 'in_app', 'Chat with {{clientName}} is back', 'You snoozed it until now.', '["clientName"]'),
   ('crm.inbox_unassigned', 'in_app', '{{clientName}} is waiting', 'Nobody could take this new chat. Assign it.', '["clientName"]')
 ) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
