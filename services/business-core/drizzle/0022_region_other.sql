-- Regions are each workspace's own list; the catch-all choice is the generic "other", not a
-- country-specific "outside_uae".
UPDATE crm_taxonomy_options SET code = 'other', label = 'Other'
  WHERE code = 'outside_uae' AND taxonomy_id IN (SELECT id FROM crm_taxonomies WHERE code = 'emirate');
--> statement-breakpoint
UPDATE crm_enquiries SET details = jsonb_set(details, '{emirate}', '"other"')
  WHERE details->>'emirate' = 'outside_uae';
--> statement-breakpoint
UPDATE crm_taxonomies SET code = 'lead_area_other' WHERE code = 'lead_area_outside_uae';
