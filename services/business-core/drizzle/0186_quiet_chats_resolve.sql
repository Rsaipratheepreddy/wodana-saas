-- Quiet chats resolve themselves (AU-2). An open chat whose last message was ours and that has been quiet for
-- the workspace's days (7 by default, 0 for never, Settings → Inbox) is resolved with a note, unless a
-- follow-up or a scheduled message is still pending on it; a client reply reopens it as before. The
-- resolution is a chat event with the method "quiet". Both tables already have forced RLS and a
-- tenant_isolation policy; wodana_app keeps its grants. Idempotent.
ALTER TABLE crm_inbox_settings
  ADD COLUMN IF NOT EXISTS auto_resolve_days smallint NOT NULL DEFAULT 7 CHECK (auto_resolve_days BETWEEN 0 AND 60);
--> statement-breakpoint
ALTER TABLE crm_conversation_events DROP CONSTRAINT IF EXISTS crm_conversation_events_method_check;
--> statement-breakpoint
ALTER TABLE crm_conversation_events ADD CONSTRAINT crm_conversation_events_method_check
  CHECK (method IS NULL OR method IN ('manual', 'bulk', 'relationship', 'queue', 'client_replied', 'schedule', 'enquiry', 'quiet'));
