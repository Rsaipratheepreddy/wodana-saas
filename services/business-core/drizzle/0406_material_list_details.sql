-- Guide step 17 (16 Oct 2026): the Material Coordinator fills in each material's brand, colour, size and finish and a
-- sample photo (a file of the project's case); technical work waits until every material has them. Columns on the
-- material list's own table; idempotent.
ALTER TABLE project_material_items ADD COLUMN IF NOT EXISTS brand varchar(160) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE project_material_items ADD COLUMN IF NOT EXISTS colour varchar(80) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE project_material_items ADD COLUMN IF NOT EXISTS size varchar(80) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE project_material_items ADD COLUMN IF NOT EXISTS finish varchar(120) NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE project_material_items ADD COLUMN IF NOT EXISTS sample_photo_asset_id uuid;
