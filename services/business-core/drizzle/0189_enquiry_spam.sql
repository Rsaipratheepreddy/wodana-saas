-- Junk form submissions (S-13). "Mark as spam" closes an enquiry as spam, keeps it out of Sales reports and blocks
-- its contact (crm_parties.blocked_at, the inbox's block), so the same number or email sending the public form
-- again raises nothing. The public form also drops submissions whose hidden field is filled or that are sent
-- faster than a person can. crm_leads already has forced RLS and a tenant_isolation policy; wodana_app keeps its
-- grants. Idempotent.
ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS spam_at timestamptz,
  ADD COLUMN IF NOT EXISTS spam_by uuid REFERENCES users (id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_leads_spam_idx ON crm_leads (workspace_id) WHERE spam_at IS NOT NULL;
