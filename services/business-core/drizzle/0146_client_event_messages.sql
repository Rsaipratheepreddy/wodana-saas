-- Client messages: which business events message the client on WhatsApp (email is the fallback where the event
-- has one), with which approved template. A workspace without a row uses the starter template and is on.
CREATE TABLE crm_client_message_rules (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  event varchar(60) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  template_code varchar(100),
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, event),
  CONSTRAINT crm_client_message_rules_event_check CHECK (event IN (
    'crm.enquiry.created', 'portal.quote_issued', 'portal.invoice_issued', 'receivables.payment_received',
    'portal.decision_waiting', 'portal.update_published', 'project.stage_started', 'payments.reminder')),
  CONSTRAINT crm_client_message_rules_version_check CHECK (version > 0)
);
--> statement-breakpoint
ALTER TABLE crm_client_message_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE crm_client_message_rules FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON crm_client_message_rules
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
-- A blocked client gets no automatic messages (and, from the inbox, raises no notice or assignment).
ALTER TABLE crm_parties ADD COLUMN blocked_at timestamptz, ADD COLUMN blocked_by uuid REFERENCES users (id);
--> statement-breakpoint
-- One automatic message per event, record and client, however often the event is raised.
CREATE UNIQUE INDEX crm_messages_event_key_uidx ON crm_messages (workspace_id, (metadata->>'eventKey')) WHERE metadata ? 'eventKey';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON crm_client_message_rules TO wodana_app;
  END IF;
END $$;
