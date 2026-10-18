-- Guide step 2 (16 Oct 2026): the weekly client update (a call or a written portal update) runs from the start of the
-- design, not from the design approval. A new reason the updates started from. Constraint change only; idempotent.
ALTER TABLE client_update_calls DROP CONSTRAINT IF EXISTS client_update_calls_started_from_check;
--> statement-breakpoint
ALTER TABLE client_update_calls ADD CONSTRAINT client_update_calls_started_from_check CHECK (started_from::text = ANY (ARRAY['design_start', 'design_approval', 'estimate_accepted', 'manual']::text[]));
