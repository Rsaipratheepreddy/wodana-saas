-- PLM-039: a queue's takeover countdown can run on working hours (e.g. Mon–Sun 09:00–18:00)
-- instead of elapsed time. NULL keeps the elapsed clock.
ALTER TABLE crm_queues ADD COLUMN takeover_schedule jsonb CHECK (takeover_schedule IS NULL OR jsonb_typeof(takeover_schedule) = 'object');
