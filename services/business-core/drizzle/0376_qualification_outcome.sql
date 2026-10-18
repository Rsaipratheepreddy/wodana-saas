-- §0.3 P0 (guide G): after the intro, the opportunity records its outcome. "Go ahead" names the scope (one of the
-- firm's enquiry types: furniture only, design only, design with fit-out and furniture…) and needs the client's target
-- completion date; "needs time to think" books the follow-up; "lost" closes it with a reason (the Lost transition).
-- Columns on the opportunity, with who and when. RLS untouched (crm_opportunities keeps forced RLS). Idempotent.
ALTER TABLE crm_opportunities
  ADD COLUMN IF NOT EXISTS qualification_outcome varchar(20),
  ADD COLUMN IF NOT EXISTS qualification_scope varchar(100),
  ADD COLUMN IF NOT EXISTS qualification_follow_up_on date,
  ADD COLUMN IF NOT EXISTS qualification_outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS qualification_outcome_by uuid REFERENCES users (id);
--> statement-breakpoint
ALTER TABLE crm_opportunities DROP CONSTRAINT IF EXISTS crm_opportunities_qualification_outcome_check;
--> statement-breakpoint
ALTER TABLE crm_opportunities ADD CONSTRAINT crm_opportunities_qualification_outcome_check CHECK (
  (qualification_outcome IS NULL AND qualification_outcome_at IS NULL)
  OR (qualification_outcome = 'proceed' AND qualification_scope IS NOT NULL AND qualification_outcome_at IS NOT NULL)
  OR (qualification_outcome = 'needs_time' AND qualification_follow_up_on IS NOT NULL AND qualification_outcome_at IS NOT NULL));
