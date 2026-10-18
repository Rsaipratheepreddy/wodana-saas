-- Guide steps 23–24 (16 Oct 2026): the lead designer's check that the items match the design (part of the single
-- pre-installation checklist), and the person with a login on each delivery or installation visit (the project manager
-- when nobody booked has one). Columns on their own records; idempotent.
ALTER TABLE delivery_projects ADD COLUMN IF NOT EXISTS design_checked_by uuid REFERENCES users (id);
--> statement-breakpoint
ALTER TABLE delivery_projects ADD COLUMN IF NOT EXISTS design_checked_at timestamptz;
--> statement-breakpoint
ALTER TABLE logistics_assignments ADD COLUMN IF NOT EXISTS site_member_id uuid;
