-- One enquiry type, one flow (plan §5a). The product has no flow object any more: each enquiry type owns its steps.
--   * crm_flows.enquiry_type_option_id: the enquiry type that owns the flow (at most one flow per type, unique).
--   * crm_flows.split_from_flow_id: the flow this one was copied from when a flow several types shared was split;
--     jobs pinned to the shared flow keep their pinned version.
--   * crm_taxonomy_options.color: the colour a firm picks for the type (1–6, the chart hues); empty means the colour
--     derived from its code.
-- Existing data is upgraded on read, inside each workspace's tenant transaction (shared flows are split there).
-- Runs as the migration owner, so forced RLS is never disabled. Idempotent.
ALTER TABLE crm_taxonomy_options ADD COLUMN IF NOT EXISTS color smallint;
--> statement-breakpoint
ALTER TABLE crm_taxonomy_options DROP CONSTRAINT IF EXISTS crm_taxonomy_options_color_check;
--> statement-breakpoint
ALTER TABLE crm_taxonomy_options ADD CONSTRAINT crm_taxonomy_options_color_check CHECK (color IS NULL OR color BETWEEN 1 AND 6);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_taxonomy_options_workspace_id_uidx ON crm_taxonomy_options (workspace_id, id);
--> statement-breakpoint
ALTER TABLE crm_flows ADD COLUMN IF NOT EXISTS enquiry_type_option_id uuid;
--> statement-breakpoint
ALTER TABLE crm_flows ADD COLUMN IF NOT EXISTS split_from_flow_id uuid;
--> statement-breakpoint
ALTER TABLE crm_flows DROP CONSTRAINT IF EXISTS crm_flows_enquiry_type_fkey;
--> statement-breakpoint
ALTER TABLE crm_flows ADD CONSTRAINT crm_flows_enquiry_type_fkey
  FOREIGN KEY (workspace_id, enquiry_type_option_id) REFERENCES crm_taxonomy_options (workspace_id, id);
--> statement-breakpoint
ALTER TABLE crm_flows DROP CONSTRAINT IF EXISTS crm_flows_split_from_fkey;
--> statement-breakpoint
ALTER TABLE crm_flows ADD CONSTRAINT crm_flows_split_from_fkey
  FOREIGN KEY (workspace_id, split_from_flow_id) REFERENCES crm_flows (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS crm_flows_enquiry_type_uidx ON crm_flows (workspace_id, enquiry_type_option_id) WHERE enquiry_type_option_id IS NOT NULL;
