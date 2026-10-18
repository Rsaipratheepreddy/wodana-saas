-- §0.3 P0: an enquiry's project type and floor plan are fixed fields a firm can hide or require (before converting,
-- for example). Widen the list of fixed fields that can be hidden. Settings rows are untouched; RLS untouched. Idempotent.
ALTER TABLE crm_enquiry_field_settings DROP CONSTRAINT IF EXISTS crm_enquiry_field_settings_field_key_check;
--> statement-breakpoint
ALTER TABLE crm_enquiry_field_settings ADD CONSTRAINT crm_enquiry_field_settings_field_key_check
  CHECK (field_key IN ('email', 'customerType', 'area', 'budgetRange', 'summary', 'projectType', 'floorPlan'));
