-- Round-robin lead routing: each Sales queue says how it shares new enquiries and chats.
--   * balanced (the default, unchanged behaviour): the eligible person with the lightest load against their capacity
--     and weight; round_robin_cursor only breaks ties.
--   * round_robin: strict turns through the queue's people, using and advancing round_robin_cursor. Rules,
--     availability, skills, languages and the returning client's owner still decide who is eligible; capacity still caps.
-- One column with a default and a check on crm_queues, so every existing queue stays balanced. crm_queues keeps its
-- forced RLS, tenant_isolation policy and grants. Idempotent.
ALTER TABLE crm_queues ADD COLUMN IF NOT EXISTS assignment_mode varchar(20) NOT NULL DEFAULT 'balanced';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crm_queues_assignment_mode_check') THEN
    ALTER TABLE crm_queues ADD CONSTRAINT crm_queues_assignment_mode_check CHECK (assignment_mode IN ('balanced', 'round_robin'));
  END IF;
END $$;
