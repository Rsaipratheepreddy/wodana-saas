-- Inbound email in the team inbox (PLM-025): a firm forwards its enquiries mailbox to a Wodana address, and each
-- email lands in the Inbox as a conversation on the email channel; replies go out by email in the same thread.
--
-- 1. crm_inbound_email_addresses: the workspace's inbound address (configuration). Its local part is generated and
--    unguessable, unique across all workspaces; the domain comes from INBOUND_EMAIL_DOMAIN. Regenerating replaces it,
--    and the old address stops working. Version-checked; a retried command (same command id) lands once.
-- 2. crm_email_messages: the email facts of a chat message, both ways: its Message-ID (one per workspace, so the same
--    email twice is one message), In-Reply-To and References (threading), sender, recipients, subject and the whole
--    plain text (the chat shows it without the quoted history).
-- 3. crm_message_attachments.position: an email carries several files; a WhatsApp message keeps its one file at 0.
-- 4. inbound_webhook_tokens: the signed webhook tokens already seen, so a captured request can't be replayed. Platform
--    data (no workspace): forced RLS with no policy, so only the SECURITY DEFINER functions below touch it.
-- 5. resolve_inbound_email_workspace(): the recipient's workspace, before the tenant transaction (cross-tenant lookup).
-- Workspace tables have workspace_id, forced RLS and the tenant_isolation policy. Nothing is backfilled. Idempotent;
-- never disables RLS.
CREATE TABLE IF NOT EXISTS crm_inbound_email_addresses (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  local_part varchar(64) NOT NULL CHECK (local_part ~ '^[a-z0-9][a-z0-9-]{5,62}$'),
  status varchar(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_command_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES users (id),
  updated_by uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_inbound_email_addresses_local_part_uidx ON crm_inbound_email_addresses (local_part);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_email_messages (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES crm_messages (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  direction varchar(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  internet_message_id varchar(998) NOT NULL CHECK (length(internet_message_id) > 2),
  -- The id the sending provider gave our reply (Mailgun's), when it differs from ours.
  provider_message_id varchar(998),
  in_reply_to varchar(998),
  reference_ids text[] NOT NULL DEFAULT '{}',
  from_address varchar(320) NOT NULL,
  from_name varchar(240),
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject varchar(998) NOT NULL DEFAULT '',
  -- The subject without "Re:"/"Fwd:", lower case: the fallback thread key (same sender, same subject, recent).
  subject_key varchar(998) NOT NULL DEFAULT '',
  full_text text,
  sent_at timestamptz,
  -- The moment the row was written (not the transaction's start), so "the latest email" is exact.
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, message_id),
  FOREIGN KEY (workspace_id, conversation_id) REFERENCES crm_conversations (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_email_messages_internet_id_uidx ON crm_email_messages (workspace_id, internet_message_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_email_messages_provider_idx ON crm_email_messages (workspace_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_email_messages_conversation_idx ON crm_email_messages (workspace_id, conversation_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_email_messages_subject_idx ON crm_email_messages (workspace_id, subject_key, created_at);
--> statement-breakpoint
ALTER TABLE crm_message_attachments ADD COLUMN IF NOT EXISTS position smallint NOT NULL DEFAULT 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_message_attachments_position_check') THEN
    ALTER TABLE crm_message_attachments ADD CONSTRAINT crm_message_attachments_position_check CHECK (position BETWEEN 0 AND 49);
  END IF;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS crm_message_attachments_message_uidx;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_message_attachments_message_position_uidx ON crm_message_attachments (workspace_id, message_id, position) WHERE message_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS inbound_webhook_tokens (
  provider varchar(20) NOT NULL CHECK (provider ~ '^[a-z_]{2,20}$'),
  token varchar(200) NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, token)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS inbound_webhook_tokens_seen_idx ON inbound_webhook_tokens (seen_at);
--> statement-breakpoint
ALTER TABLE inbound_webhook_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE inbound_webhook_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A token seen for the first time is kept (true); one seen before is a replay (false). Tokens older than the
-- signature window are dropped on the way, so the store stays small.
CREATE OR REPLACE FUNCTION public.claim_inbound_webhook_token(candidate_provider varchar, candidate_token varchar, keep_seconds integer)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $$
DECLARE kept integer;
BEGIN
  DELETE FROM public.inbound_webhook_tokens WHERE seen_at < now() - make_interval(secs => greatest(keep_seconds, 60));
  INSERT INTO public.inbound_webhook_tokens (provider, token) VALUES (candidate_provider, candidate_token) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS kept = ROW_COUNT;
  RETURN kept = 1;
END $$;
--> statement-breakpoint
-- A delivery that failed before it was stored gives its token back, so the provider's retry is accepted.
CREATE OR REPLACE FUNCTION public.release_inbound_webhook_token(candidate_provider varchar, candidate_token varchar)
  RETURNS void
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $$
  DELETE FROM public.inbound_webhook_tokens WHERE provider = candidate_provider AND token = candidate_token;
$$;
--> statement-breakpoint
-- The workspace an inbound address belongs to (active addresses of active workspaces only). Everything after this
-- runs inside that workspace's tenant transaction.
CREATE OR REPLACE FUNCTION public.resolve_inbound_email_workspace(candidate varchar)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
  AS $$
  SELECT address.workspace_id FROM public.crm_inbound_email_addresses address
    JOIN public.workspaces workspace ON workspace.id = address.workspace_id
   WHERE address.local_part = lower(candidate) AND address.status = 'active' AND workspace.status = 'active'
   LIMIT 1;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.claim_inbound_webhook_token(varchar, varchar, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.release_inbound_webhook_token(varchar, varchar) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_inbound_email_workspace(varchar) FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['crm_inbound_email_addresses', 'crm_email_messages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = target AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, target);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON crm_inbound_email_addresses TO wodana_app;
    -- DELETE: a client's privacy erasure removes their emails' addresses, subjects and text.
    GRANT SELECT, INSERT, DELETE ON crm_email_messages TO wodana_app;
    GRANT UPDATE (provider_message_id) ON crm_email_messages TO wodana_app;
    GRANT EXECUTE ON FUNCTION public.claim_inbound_webhook_token(varchar, varchar, integer) TO wodana_app;
    GRANT EXECUTE ON FUNCTION public.release_inbound_webhook_token(varchar, varchar) TO wodana_app;
    GRANT EXECUTE ON FUNCTION public.resolve_inbound_email_workspace(varchar) TO wodana_app;
  END IF;
END $$;
