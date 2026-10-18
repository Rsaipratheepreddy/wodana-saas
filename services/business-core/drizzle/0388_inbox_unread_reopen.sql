-- The team inbox: an Unread view for each person, and Reopen only by whoever resolved the chat or an inbox manager.
--
-- 1. crm_conversation_reads: when each person last opened each chat. A chat is unread for a person while its latest
--    client message is newer than that; opening the chat marks it read for that person only.
-- 2. crm_conversations.read_baseline_at: client messages up to this moment count as read by everyone. Set once, for the
--    chats that had nothing unread before reads were kept per person, so they don't all turn unread at once.
-- 3. crm_conversations.resolved_by: who resolved the chat (null when the system did, e.g. a quiet chat), filled from
--    each resolved chat's own history.
-- crm_conversation_reads is workspace-scoped with forced RLS and a tenant_isolation policy; crm_conversations keeps
-- its own. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS crm_conversation_reads (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES crm_conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, conversation_id, user_id)
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'crm_conversation_reads_conversation_id_workspace_guard' AND tgrelid = 'crm_conversation_reads'::regclass) THEN
    CREATE TRIGGER crm_conversation_reads_conversation_id_workspace_guard BEFORE INSERT OR UPDATE ON crm_conversation_reads
      FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('crm_conversations', 'conversation_id');
  END IF;
END $$;
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['crm_conversation_reads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = table_name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('crm_conversation_reads', 'clear', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition, clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'crm_conversations' AND column_name = 'read_baseline_at') THEN
    ALTER TABLE crm_conversations ADD COLUMN read_baseline_at timestamptz;
    -- Only the first time: a chat with nothing unread then is read by everyone up to its latest client message.
    UPDATE crm_conversations SET read_baseline_at = last_inbound_at WHERE unread_count = 0 AND last_inbound_at IS NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE crm_conversations ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users (id) ON DELETE SET NULL;
--> statement-breakpoint
UPDATE crm_conversations conversation SET resolved_by = last.actor_user_id
  FROM (SELECT DISTINCT ON (event.workspace_id, event.conversation_id) event.workspace_id, event.conversation_id, event.actor_user_id
          FROM crm_conversation_events event
         WHERE event.kind = 'resolved'
         ORDER BY event.workspace_id, event.conversation_id, event.created_at DESC, event.id DESC) last
 WHERE conversation.status = 'closed' AND conversation.resolved_by IS NULL AND last.actor_user_id IS NOT NULL
   AND last.workspace_id = conversation.workspace_id AND last.conversation_id = conversation.id;
