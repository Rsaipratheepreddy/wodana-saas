-- Enquiry titles read "Customer Name (Area, Region)", "Customer Name (Region)" or "Customer Name (typed place)" instead of
-- "Customer Name — Area, Region". Only auto-built titles change: an enquiry's title is always composed from its customer's
-- name and place (nobody types it), so a title that is exactly the customer's current name, " — " or " – ", then the place,
-- on an enquiry that has a place, is rewritten. An opportunity that kept its enquiry's title word for word follows it, and so
-- does a project that kept its opportunity's title; any title someone typed stays as it is. One statement, so every part sees
-- the titles as they were. Data only on existing tenant tables (forced RLS and policies unchanged); idempotent (a rewritten
-- title no longer matches); never disables RLS.
WITH auto AS (
  SELECT enquiry.workspace_id, enquiry.id, enquiry.title AS old_title, named.name,
         substr(enquiry.title, char_length(named.name) + 4) AS place
    FROM crm_enquiries enquiry
    JOIN crm_parties party ON party.workspace_id = enquiry.workspace_id AND party.id = enquiry.party_id
   CROSS JOIN LATERAL (SELECT btrim(party.display_name) AS name) named
   WHERE named.name <> ''
     AND left(enquiry.title, char_length(named.name) + 3) IN (named.name || ' — ', named.name || ' – ')
     AND btrim(substr(enquiry.title, char_length(named.name) + 4)) <> ''
     AND coalesce(nullif(btrim(enquiry.details->>'emirate'), ''), nullif(btrim(enquiry.details->>'area'), ''),
                  nullif(btrim(enquiry.details->>'location'), '')) IS NOT NULL
), opportunity_titles AS (
  SELECT opportunity.workspace_id, opportunity.id, opportunity.title AS old_title,
         left(auto.name || ' (' || auto.place || ')', 240) AS new_title
    FROM crm_opportunities opportunity
    JOIN crm_leads lead ON lead.workspace_id = opportunity.workspace_id AND lead.id = opportunity.lead_id
    JOIN auto ON auto.workspace_id = lead.workspace_id AND auto.id = lead.enquiry_id
   WHERE opportunity.title IN (auto.old_title, auto.name || ' — ' || auto.place, auto.name || ' – ' || auto.place)
), projects AS (
  UPDATE delivery_projects project SET name = opportunity_titles.new_title
    FROM pre_project_cases pre_case
    JOIN opportunity_titles ON opportunity_titles.workspace_id = pre_case.workspace_id AND opportunity_titles.id = pre_case.opportunity_id
   WHERE pre_case.workspace_id = project.workspace_id AND pre_case.id = project.case_id
     AND project.name = opportunity_titles.old_title
  RETURNING project.id
), opportunities AS (
  UPDATE crm_opportunities opportunity SET title = opportunity_titles.new_title
    FROM opportunity_titles
   WHERE opportunity_titles.workspace_id = opportunity.workspace_id AND opportunity_titles.id = opportunity.id
  RETURNING opportunity.id
)
UPDATE crm_enquiries enquiry SET title = left(auto.name || ' (' || auto.place || ')', 240)
  FROM auto
 WHERE auto.workspace_id = enquiry.workspace_id AND auto.id = enquiry.id;
