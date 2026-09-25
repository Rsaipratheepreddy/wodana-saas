-- PLM-093 duplicates and PLM-037 returning customers.
-- A duplicate is a closed lead linked to the open original; the original source of a returning
-- customer's enquiry is kept when it is switched to the returning source.
ALTER TYPE crm_lead_status ADD VALUE IF NOT EXISTS 'duplicate';
--> statement-breakpoint
ALTER TABLE crm_leads ADD COLUMN duplicate_of_lead_id uuid REFERENCES crm_leads (id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX crm_leads_duplicate_of_idx ON crm_leads (workspace_id, duplicate_of_lead_id) WHERE duplicate_of_lead_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX crm_leads_party_open_idx ON crm_leads (workspace_id, party_id, created_at) WHERE closed_at IS NULL;
--> statement-breakpoint
ALTER TABLE crm_enquiries ADD COLUMN original_source varchar(100), ADD COLUMN original_channel varchar(60);
