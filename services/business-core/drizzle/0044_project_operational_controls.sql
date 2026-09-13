ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS calendar jsonb;
ALTER TABLE project_bookings ADD COLUMN IF NOT EXISTS slots jsonb NOT NULL DEFAULT '[]';
