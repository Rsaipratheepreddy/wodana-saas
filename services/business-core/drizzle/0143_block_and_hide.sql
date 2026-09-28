-- Block a number (and mark it as spam), and hide a message from Wodana's views. Blocked clients' messages are
-- still stored but raise no notice or assignment and get no automatic messages; a hidden message keeps its
-- content for the audit and can be shown again by an administrator.
ALTER TABLE crm_parties ADD COLUMN spam_at timestamptz;
--> statement-breakpoint
ALTER TABLE crm_messages ADD COLUMN hidden_at timestamptz, ADD COLUMN hidden_by uuid REFERENCES users (id);
--> statement-breakpoint
ALTER TABLE crm_conversation_events DROP CONSTRAINT crm_conversation_events_kind_check;
--> statement-breakpoint
ALTER TABLE crm_conversation_events ADD CONSTRAINT crm_conversation_events_kind_check CHECK (kind IN (
  'resolved', 'reopened', 'snoozed', 'woke', 'assigned', 'unassigned', 'labelled', 'unlabelled', 'linked', 'blocked', 'unblocked', 'hidden', 'unhidden'));
