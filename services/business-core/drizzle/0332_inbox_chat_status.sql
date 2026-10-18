-- PLM-137: a status on every chat and the inbox's three closing messages.
--
-- 1. A chat is Open, Unresolved (handled, waiting on the client), Snoozed, Resolved (stored 'closed', the archive it
--    always was) or Spam (PLM-138: its messages are kept, nobody is told, nothing automatic goes). A chat from before
--    keeps its state. The list is extended in place, so a state another release added stays.
-- 2. The chat's own history: 'unresolved', 'spam', 'unspam' and 'closing_sent' lines; the methods 'contact_spam' (a
--    spam contact wrote again) and 'closing' (the closing message set the state).
-- 3. crm_conversations.closing_due_at: from when "Closing the chat" may be offered, our last reply plus the firm's
--    quiet working hours; cleared when the client writes. Re-checked when it is sent.
-- 4. crm_inbox_settings: the three closing texts (null = the product's wording), the lead form link {{form_link}}
--    fills, and the quiet working hours before "Closing the chat" (3 by default), with their own version.
-- 5. The WhatsApp template variable source 'form.link'.
-- 6. Permission crm.inbox.close_chats (send "Closing the chat"): part of the inbox's Team chats level, so every role
--    holding crm.inbox.team or crm.inbox.manage (the Sales admins, owners and administrators) gets it.
-- crm_conversations, crm_conversation_events, crm_inbox_settings and crm_template_variables keep their forced RLS
-- and tenant_isolation policy. Idempotent; never disables RLS.
DO $$
DECLARE
  target record;
  definition text;
  allowed text[];
  wanted text[];
  value text;
BEGIN
  FOR target IN SELECT * FROM (VALUES
    ('crm_conversations', 'crm_conversations_status_check', 'status', ARRAY['open', 'unresolved', 'snoozed', 'closed', 'spam']),
    ('crm_conversation_events', 'crm_conversation_events_kind_check', 'kind', ARRAY['unresolved', 'spam', 'unspam', 'closing_sent']),
    ('crm_template_variables', 'crm_template_variables_source_check', 'source', ARRAY['form.link'])
  ) AS list (relation, constraint_name, column_name, additions) LOOP
    SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conname = target.constraint_name AND conrelid = target.relation::regclass;
    SELECT coalesce(array_agg(match[1] ORDER BY ordinality), '{}') INTO allowed
      FROM regexp_matches(coalesce(definition, ''), '''([a-z_.]+)''', 'g') WITH ORDINALITY AS found (match, ordinality);
    wanted := allowed;
    FOREACH value IN ARRAY target.additions LOOP
      IF NOT value = ANY (wanted) THEN wanted := wanted || value; END IF;
    END LOOP;
    IF wanted IS DISTINCT FROM allowed THEN
      IF definition IS NOT NULL THEN EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target.relation, target.constraint_name); END IF;
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IN (%s))', target.relation, target.constraint_name, target.column_name,
        (SELECT string_agg(quote_literal(entry), ', ' ORDER BY position) FROM unnest(wanted) WITH ORDINALITY AS item (entry, position)));
    END IF;
  END LOOP;
  -- Methods allow NULL, so their list is rebuilt the same way with "method IS NULL OR".
  SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint
   WHERE conname = 'crm_conversation_events_method_check' AND conrelid = 'crm_conversation_events'::regclass;
  SELECT coalesce(array_agg(match[1] ORDER BY ordinality), '{}') INTO allowed
    FROM regexp_matches(coalesce(definition, ''), '''([a-z_.]+)''', 'g') WITH ORDINALITY AS found (match, ordinality);
  wanted := allowed;
  FOREACH value IN ARRAY ARRAY['contact_spam', 'closing'] LOOP
    IF NOT value = ANY (wanted) THEN wanted := wanted || value; END IF;
  END LOOP;
  IF wanted IS DISTINCT FROM allowed THEN
    IF definition IS NOT NULL THEN ALTER TABLE crm_conversation_events DROP CONSTRAINT crm_conversation_events_method_check; END IF;
    EXECUTE format('ALTER TABLE crm_conversation_events ADD CONSTRAINT crm_conversation_events_method_check CHECK (method IS NULL OR method IN (%s))',
      (SELECT string_agg(quote_literal(entry), ', ' ORDER BY position) FROM unnest(wanted) WITH ORDINALITY AS item (entry, position)));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE crm_conversations ADD COLUMN IF NOT EXISTS closing_due_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_conversations_closing_due_idx ON crm_conversations (workspace_id, closing_due_at)
  WHERE closing_due_at IS NOT NULL AND status IN ('open', 'unresolved');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_conversations_spam_idx ON crm_conversations (workspace_id, last_message_at DESC) WHERE status = 'spam';
--> statement-breakpoint
ALTER TABLE crm_inbox_settings
  ADD COLUMN IF NOT EXISTS closing_received_text varchar(1024),
  ADD COLUMN IF NOT EXISTS closing_form_text varchar(1024),
  ADD COLUMN IF NOT EXISTS closing_close_text varchar(1024),
  ADD COLUMN IF NOT EXISTS closing_form_url varchar(500),
  ADD COLUMN IF NOT EXISTS closing_after_hours smallint NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS closing_version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_inbox_settings_closing_check' AND conrelid = 'crm_inbox_settings'::regclass) THEN
    ALTER TABLE crm_inbox_settings ADD CONSTRAINT crm_inbox_settings_closing_check CHECK (
      closing_after_hours BETWEEN 1 AND 72 AND closing_version > 0
      AND (closing_form_url IS NULL OR closing_form_url ~ '^https://[^[:space:]]{3,}$')
      AND (closing_received_text IS NULL OR length(btrim(closing_received_text)) > 0)
      AND (closing_form_text IS NULL OR length(btrim(closing_form_text)) > 0)
      AND (closing_close_text IS NULL OR length(btrim(closing_close_text)) > 0));
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('crm.inbox.close_chats', 'Send the closing message to a quiet chat')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE permission.code = 'crm.inbox.close_chats'
   AND ((role.is_system AND role.code IN ('owner', 'administrator'))
     OR EXISTS (SELECT 1 FROM role_permissions held JOIN permissions inbox ON inbox.id = held.permission_id
                 WHERE held.role_id = role.id AND inbox.code IN ('crm.inbox.team', 'crm.inbox.manage')))
ON CONFLICT (role_id, permission_id) DO NOTHING;
