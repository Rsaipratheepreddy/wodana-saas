-- §0.3 P0 (guide J): after Proposal 1 (the design fee) is won, the client may withdraw from Proposal 2 (the main
-- quotation). The account manager records it with the reason; whoever approves deals confirms it after reviewing it
-- (or sends it back). A withdrawn Proposal 2 is never Won or Lost: the opportunity stays won for its design, and the
-- "Withdrawn Proposal 2" list shows it. Columns on the proposal, with who and when; RLS untouched. Idempotent.
ALTER TABLE crm_opportunity_proposals
  ADD COLUMN IF NOT EXISTS withdrawal_status varchar(20),
  ADD COLUMN IF NOT EXISTS withdrawal_reason varchar(500),
  ADD COLUMN IF NOT EXISTS withdrawal_requested_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS withdrawal_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawal_decided_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS withdrawal_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawal_note varchar(500);
--> statement-breakpoint
ALTER TABLE crm_opportunity_proposals DROP CONSTRAINT IF EXISTS crm_opportunity_proposals_withdrawal_check;
--> statement-breakpoint
ALTER TABLE crm_opportunity_proposals ADD CONSTRAINT crm_opportunity_proposals_withdrawal_check CHECK (
  withdrawal_status IS NULL
  OR (kind = 'main' AND won_at IS NULL AND withdrawal_reason IS NOT NULL AND withdrawal_requested_at IS NOT NULL
      AND (withdrawal_status = 'requested' OR (withdrawal_status = 'confirmed' AND withdrawal_decided_at IS NOT NULL))));
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('crm.proposal_withdrawal_requested', 'in_app', 'Confirm the withdrawal · {{reference}} · {{clientName}}', '{{actor}}: the client is withdrawing from Proposal 2. {{reason}}', '["reference","clientName","actor","reason"]'),
  ('crm.proposal_withdrawal_decided', 'in_app', 'Proposal 2 withdrawal {{decision}} · {{reference}}', '{{actor}} {{decision}} it. {{note}}', '["reference","clientName","actor","decision","note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
