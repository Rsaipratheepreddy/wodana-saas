-- Team inbox: files in chats, both ways, and the WhatsApp number each chat is with.
--
-- A chat remembers the number the client last wrote to; every reply (typed, automatic or scheduled) goes from it.
ALTER TABLE crm_conversations ADD COLUMN connection_id uuid REFERENCES integration_connections (id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX crm_conversations_connection_idx ON crm_conversations (workspace_id, connection_id) WHERE connection_id IS NOT NULL;
--> statement-breakpoint
UPDATE crm_conversations conversation SET connection_id = latest.connection_id
  FROM (
    SELECT DISTINCT ON (message.workspace_id, message.conversation_id) message.workspace_id, message.conversation_id, connection.id AS connection_id
      FROM crm_messages message
      JOIN integration_connections connection ON connection.workspace_id = message.workspace_id AND connection.provider = 'whatsapp'
       AND connection.id::text = message.metadata->>'connectionId'
     WHERE message.direction = 'inbound' AND message.metadata ? 'connectionId'
     ORDER BY message.workspace_id, message.conversation_id, message.created_at DESC
  ) latest
 WHERE conversation.workspace_id = latest.workspace_id AND conversation.id = latest.conversation_id AND conversation.channel = 'whatsapp';
--> statement-breakpoint
-- One file per message (WhatsApp sends one media item per message), in the baseline's crm_message_attachments
-- (unused until now). An inbound file arrives as a provider media id and waits ('pending') until the worker
-- fetches it into private storage ('stored'); a fetch that keeps failing ends as 'failed', and the message itself
-- is never lost. An outbound file is uploaded first ('stored', no message yet) and joins its message on send.
ALTER TABLE crm_message_attachments
  ALTER COLUMN message_id DROP NOT NULL,
  ALTER COLUMN object_key DROP NOT NULL,
  ALTER COLUMN file_name DROP NOT NULL,
  ALTER COLUMN content_type DROP NOT NULL,
  ALTER COLUMN byte_size DROP NOT NULL,
  ALTER COLUMN checksum DROP NOT NULL,
  ALTER COLUMN content_type TYPE varchar(160),
  ADD COLUMN conversation_id uuid,
  ADD COLUMN direction varchar(10) NOT NULL DEFAULT 'inbound',
  ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'document',
  ADD COLUMN provider_media_id varchar(120),
  ADD COLUMN connection_id uuid REFERENCES integration_connections (id) ON DELETE SET NULL,
  ADD COLUMN status varchar(20) NOT NULL DEFAULT 'stored',
  ADD COLUMN attempts smallint NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN failure_code varchar(120),
  ADD COLUMN uploaded_by uuid REFERENCES users (id),
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
UPDATE crm_message_attachments attachment SET conversation_id = message.conversation_id,
       direction = CASE WHEN message.direction = 'inbound' THEN 'inbound' ELSE 'outbound' END
  FROM crm_messages message WHERE message.workspace_id = attachment.workspace_id AND message.id = attachment.message_id;
--> statement-breakpoint
ALTER TABLE crm_message_attachments
  ALTER COLUMN conversation_id SET NOT NULL,
  ALTER COLUMN direction DROP DEFAULT,
  ALTER COLUMN kind DROP DEFAULT,
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD CONSTRAINT crm_message_attachments_conversation_fk FOREIGN KEY (workspace_id, conversation_id) REFERENCES crm_conversations (workspace_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT crm_message_attachments_direction_check CHECK (direction IN ('inbound', 'outbound')),
  ADD CONSTRAINT crm_message_attachments_kind_check CHECK (kind IN ('image', 'document', 'audio', 'video', 'sticker')),
  ADD CONSTRAINT crm_message_attachments_status_check CHECK (status IN ('pending', 'stored', 'failed')),
  ADD CONSTRAINT crm_message_attachments_stored_check CHECK (status <> 'stored' OR (object_key IS NOT NULL AND byte_size IS NOT NULL AND content_type IS NOT NULL)),
  ADD CONSTRAINT crm_message_attachments_pending_check CHECK (status <> 'pending' OR provider_media_id IS NOT NULL),
  ADD CONSTRAINT crm_message_attachments_size_check CHECK (byte_size IS NULL OR byte_size > 0),
  ADD CONSTRAINT crm_message_attachments_attempts_check CHECK (attempts >= 0),
  ADD CONSTRAINT crm_message_attachments_version_check CHECK (version > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX crm_message_attachments_message_uidx ON crm_message_attachments (workspace_id, message_id) WHERE message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX crm_message_attachments_conversation_idx ON crm_message_attachments (workspace_id, conversation_id, created_at);
--> statement-breakpoint
CREATE INDEX crm_message_attachments_due_idx ON crm_message_attachments (next_attempt_at) WHERE status = 'pending';
--> statement-breakpoint
-- Forced row security and tenant_isolation come from the baseline; stated again so this table's rules read in one place.
ALTER TABLE crm_message_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_message_attachments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Files that arrived before this migration: Meta keeps media for about 30 days, so recent ones are fetched now and
-- older ones say they can no longer be downloaded.
INSERT INTO crm_message_attachments (workspace_id, conversation_id, message_id, direction, kind, content_type, file_name, provider_media_id, connection_id, status, next_attempt_at, failure_code)
SELECT message.workspace_id, message.conversation_id, message.id, CASE WHEN message.direction = 'inbound' THEN 'inbound' ELSE 'outbound' END,
       message.metadata->>'messageType', left(message.metadata->>'mimeType', 160), left(message.metadata->>'fileName', 240),
       left(message.metadata->>'mediaId', 120), connection.id,
       CASE WHEN message.created_at > now() - interval '29 days' AND connection.id IS NOT NULL THEN 'pending' ELSE 'failed' END,
       now(),
       CASE WHEN message.created_at > now() - interval '29 days' AND connection.id IS NOT NULL THEN NULL ELSE 'media_expired' END
  FROM crm_messages message
  LEFT JOIN integration_connections connection ON connection.workspace_id = message.workspace_id AND connection.provider = 'whatsapp'
   AND connection.id::text = message.metadata->>'connectionId'
 WHERE message.direction IN ('inbound', 'outbound')
   AND message.metadata->>'messageType' IN ('image', 'document', 'audio', 'video', 'sticker')
   AND COALESCE(message.metadata->>'mediaId', '') <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The inbox's own due work (files to fetch; scheduled messages from 0167). A separate SECURITY DEFINER function,
-- read beside list_crm_workspaces_with_due_work() by the same worker pass, so other modules' edits to that
-- function and these never overwrite each other.
CREATE OR REPLACE FUNCTION public.list_crm_workspaces_with_due_inbox_work() RETURNS TABLE(workspace_id uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT attachment.workspace_id FROM crm_message_attachments attachment
   WHERE attachment.status = 'pending' AND attachment.next_attempt_at <= now();
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.list_crm_workspaces_with_due_inbox_work() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm_message_attachments TO wodana_app;
    GRANT EXECUTE ON FUNCTION public.list_crm_workspaces_with_due_inbox_work() TO wodana_app;
  END IF;
END $$;
