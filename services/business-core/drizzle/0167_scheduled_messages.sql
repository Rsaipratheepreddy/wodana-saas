-- Team inbox: "Send later". A reply written now and sent at a chosen time: an approved template at any time, free
-- text only while WhatsApp's 24-hour window will still be open then. Until it goes it can be edited or cancelled;
-- at its time the worker sends it through the same path as a typed reply. `rendered_text` is exactly what the client
-- will read (the template with its values), so the chat, the confirmation card and the audit show the same words.
CREATE TABLE crm_scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  body_text text,
  template_id uuid,
  template_code varchar(512),
  template_parameters text[] NOT NULL DEFAULT '{}',
  rendered_text text NOT NULL,
  send_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'scheduled',
  message_id uuid REFERENCES crm_messages (id) ON DELETE SET NULL,
  failure_reason varchar(500),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  updated_by uuid REFERENCES users (id),
  cancelled_by uuid REFERENCES users (id),
  cancelled_at timestamptz,
  sent_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES crm_conversations (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT crm_scheduled_messages_request_key UNIQUE (workspace_id, client_request_id),
  CONSTRAINT crm_scheduled_messages_status_check CHECK (status IN ('scheduled', 'sent', 'cancelled', 'failed')),
  CONSTRAINT crm_scheduled_messages_content_check CHECK ((body_text IS NOT NULL) <> (template_id IS NOT NULL)),
  CONSTRAINT crm_scheduled_messages_text_check CHECK (body_text IS NULL OR length(btrim(body_text)) BETWEEN 1 AND 4096),
  CONSTRAINT crm_scheduled_messages_template_check CHECK (template_id IS NULL OR template_code IS NOT NULL),
  CONSTRAINT crm_scheduled_messages_parameters_check CHECK (cardinality(template_parameters) <= 20),
  CONSTRAINT crm_scheduled_messages_sent_check CHECK (status <> 'sent' OR (message_id IS NOT NULL AND sent_at IS NOT NULL)),
  CONSTRAINT crm_scheduled_messages_cancelled_check CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL),
  CONSTRAINT crm_scheduled_messages_version_check CHECK (version > 0)
);
--> statement-breakpoint
CREATE INDEX crm_scheduled_messages_due_idx ON crm_scheduled_messages (send_at) WHERE status = 'scheduled';
--> statement-breakpoint
CREATE INDEX crm_scheduled_messages_conversation_idx ON crm_scheduled_messages (workspace_id, conversation_id, send_at);
--> statement-breakpoint
ALTER TABLE crm_scheduled_messages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_scheduled_messages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_scheduled_messages
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.list_crm_workspaces_with_due_inbox_work() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT due.workspace_id FROM (
    SELECT attachment.workspace_id FROM crm_message_attachments attachment
     WHERE attachment.status = 'pending' AND attachment.next_attempt_at <= now()
    UNION ALL
    SELECT scheduled.workspace_id FROM crm_scheduled_messages scheduled
     WHERE scheduled.status = 'scheduled' AND scheduled.send_at <= now()
  ) due;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_crm_workspaces_with_due_inbox_work() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON crm_scheduled_messages TO wodana_app;
    GRANT EXECUTE ON FUNCTION public.list_crm_workspaces_with_due_inbox_work() TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The person who scheduled a message is told when it could not go (the chat was resolved, the window closed, the
-- template was paused).
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.inbox_scheduled_failed', 'in_app', 'en', 1, 'approved', 'Your message to {{clientName}} wasn''t sent', '{{reason}}', '["clientName","reason"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
