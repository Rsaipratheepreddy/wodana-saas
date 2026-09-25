-- Preserve tenant-defined stages; rename only the original New enquiry stage.
UPDATE crm_pipeline_stages
SET name = 'New Opportunity', version = version + 1, updated_at = now()
WHERE name = 'New enquiry';

-- Bring existing enquiries in line with the generated, read-only title rule.
WITH locations AS (
  SELECT enquiry.id,
    btrim(party.display_name) AS customer_name,
    COALESCE(NULLIF(btrim(enquiry.details->>'area'), ''), NULLIF(btrim(enquiry.details->>'location'), '')) AS area_value,
    enquiry.details->>'emirate' AS emirate_code,
    area_choice.label AS area_label,
    COALESCE(emirate_choice.label, CASE enquiry.details->>'emirate'
      WHEN 'abu_dhabi' THEN 'Abu Dhabi' WHEN 'ajman' THEN 'Ajman'
      WHEN 'dubai' THEN 'Dubai' WHEN 'fujairah' THEN 'Fujairah'
      WHEN 'ras_al_khaimah' THEN 'Ras Al Khaimah' WHEN 'sharjah' THEN 'Sharjah'
      WHEN 'umm_al_quwain' THEN 'Umm Al Quwain'
      WHEN 'outside_uae' THEN 'Outside UAE' END) AS emirate_name
  FROM crm_enquiries enquiry
  JOIN crm_parties party ON party.workspace_id = enquiry.workspace_id AND party.id = enquiry.party_id
  LEFT JOIN crm_taxonomies emirate_taxonomy ON emirate_taxonomy.workspace_id = enquiry.workspace_id AND emirate_taxonomy.code = 'emirate'
  LEFT JOIN crm_taxonomy_options emirate_choice ON emirate_choice.workspace_id = enquiry.workspace_id
    AND emirate_choice.taxonomy_id = emirate_taxonomy.id AND emirate_choice.code = enquiry.details->>'emirate'
  LEFT JOIN crm_taxonomies area_taxonomy ON area_taxonomy.workspace_id = enquiry.workspace_id
    AND area_taxonomy.code = 'lead_area_' || (enquiry.details->>'emirate')
  LEFT JOIN crm_taxonomy_options area_choice ON area_choice.workspace_id = enquiry.workspace_id
    AND area_choice.taxonomy_id = area_taxonomy.id AND area_choice.code = enquiry.details->>'area'
  WHERE party.lifecycle <> 'erased'
), generated AS (
  SELECT id, left(concat_ws(' — ', NULLIF(customer_name, ''), NULLIF(
    CASE WHEN emirate_code = 'outside_uae' THEN COALESCE(area_label, area_value, emirate_name)
      ELSE concat_ws(', ', COALESCE(area_label, area_value), emirate_name) END, '')), 240) AS title
  FROM locations
)
UPDATE crm_enquiries enquiry SET title = generated.title, updated_at = now()
FROM generated WHERE enquiry.id = generated.id AND generated.title <> '' AND enquiry.title IS DISTINCT FROM generated.title;
