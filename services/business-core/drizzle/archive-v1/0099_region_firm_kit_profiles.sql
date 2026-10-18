UPDATE tenant_setup_profiles
SET selectable = false
WHERE kind = 'region' AND version = 1;
--> statement-breakpoint
INSERT INTO tenant_setup_profiles (kind, code, version, configuration, selectable)
SELECT kind, code, 2,
       configuration || CASE code
         WHEN 'AE' THEN '{
           "regulatoryStatus":"requires_validation",
           "calendarPolicy":{"version":1,"workingDays":[1,2,3,4,5],"holidayCalendar":"tenant_configured"},
           "taxPolicy":{"version":1,"status":"requires_validation","rates":[]},
           "privacyPolicy":{"version":1,"status":"requires_validation","noticeTemplate":null},
           "providerPolicy":{"version":1,"defaults":{},"connectionsRequired":true}
         }'::jsonb
         WHEN 'IN' THEN '{
           "regulatoryStatus":"requires_validation",
           "calendarPolicy":{"version":1,"workingDays":[1,2,3,4,5],"holidayCalendar":"tenant_configured"},
           "taxPolicy":{"version":1,"status":"requires_validation","rates":[]},
           "privacyPolicy":{"version":1,"status":"requires_validation","noticeTemplate":null},
           "providerPolicy":{"version":1,"defaults":{},"connectionsRequired":true}
         }'::jsonb
         ELSE '{"regulatoryStatus":"requires_validation"}'::jsonb
       END,
       true
FROM tenant_setup_profiles
WHERE kind = 'region' AND version = 1
ON CONFLICT (kind, code, version) DO NOTHING;
--> statement-breakpoint
UPDATE tenant_setup_profiles
SET selectable = false
WHERE kind = 'firm_kit' AND code = 'design_build' AND version = 2;
--> statement-breakpoint
INSERT INTO tenant_setup_profiles (kind, code, version, configuration, selectable)
SELECT kind, code, 3,
       configuration || '{
         "applicableJobSections":["overview","discovery","design","scope","quote","agreement","delivery","handover","money","files","timeline"]
       }'::jsonb,
       true
FROM tenant_setup_profiles
WHERE kind = 'firm_kit' AND code = 'design_build' AND version = 2
ON CONFLICT (kind, code, version) DO NOTHING;
--> statement-breakpoint
INSERT INTO tenant_setup_profiles (kind, code, version, configuration, selectable) VALUES
('firm_kit', 'interior_studio', 2, '{
  "label":"Interior design studio",
  "applicableJobSections":["overview","discovery","design","scope","quote","agreement","handover","money","files","timeline"],
  "projectWorkflow":{"version":1,"code":"studio_delivery","name":"Studio delivery","description":"Design-led work without invented procurement, manufacturing or site-delivery stages.","isDefault":true,"stages":[
    {"key":"planning","visibleName":"Plan","description":"Confirm the design engagement, owner and work plan.","phase":"planning","ownerRole":"project_manager","exitGates":["project_manager_assigned","tasks_planned"]},
    {"key":"design_delivery","visibleName":"Design delivery","description":"Coordinate the agreed design deliverables and review work.","phase":"active","ownerRole":"senior_designer","exitGates":["all_tasks_closed","all_snags_closed"]},
    {"key":"handover","visibleName":"Design handover","description":"Issue the accepted design pack and reconcile the engagement.","phase":"handover","ownerRole":"project_manager","exitGates":["all_handovers_accepted","finance_closed"]},
    {"key":"completed","visibleName":"Completed","description":"Keep the engagement as an auditable record.","phase":"completed","ownerRole":null,"exitGates":[]}
  ]}
}'::jsonb, true),
('firm_kit', 'fitout_contractor', 2, '{
  "label":"Fit-out contractor",
  "applicableJobSections":["overview","discovery","design","scope","quote","agreement","delivery","handover","money","files","timeline"],
  "projectWorkflow":{"version":1,"code":"fitout_delivery","name":"Fit-out delivery","description":"Mobilisation, coordinated site delivery and controlled handover.","isDefault":true,"stages":[
    {"key":"planning","visibleName":"Pre-start","description":"Confirm ownership, released scope and executable work.","phase":"planning","ownerRole":"project_manager","exitGates":["project_manager_assigned","tasks_planned"]},
    {"key":"mobilisation","visibleName":"Mobilisation","description":"Coordinate access, team and site readiness.","phase":"active","ownerRole":"project_manager","exitGates":[]},
    {"key":"site_delivery","visibleName":"Site delivery","description":"Deliver and inspect the released work packages.","phase":"active","ownerRole":"project_manager","exitGates":["all_tasks_closed","all_snags_closed"]},
    {"key":"handover","visibleName":"Handover","description":"Complete acceptance and final reconciliation.","phase":"handover","ownerRole":"project_manager","exitGates":["all_handovers_accepted","finance_closed"]},
    {"key":"completed","visibleName":"Completed","description":"Keep the closed project as an auditable record.","phase":"completed","ownerRole":null,"exitGates":[]}
  ]}
}'::jsonb, true),
('firm_kit', 'joinery_furniture', 2, '{
  "label":"Joinery / furniture",
  "applicableJobSections":["overview","discovery","design","scope","quote","agreement","delivery","handover","money","files","timeline"],
  "projectWorkflow":{"version":1,"code":"joinery_delivery","name":"Joinery delivery","description":"Technical release, production, delivery and installation without forcing unrelated fit-out work.","isDefault":true,"stages":[
    {"key":"planning","visibleName":"Technical release","description":"Confirm ownership, approved details and production work.","phase":"planning","ownerRole":"project_manager","exitGates":["project_manager_assigned","tasks_planned"]},
    {"key":"production","visibleName":"Production","description":"Coordinate materials, factory output and quality evidence.","phase":"active","ownerRole":"procurement_production","exitGates":[]},
    {"key":"delivery","visibleName":"Delivery & installation","description":"Receive, install, inspect and close defects.","phase":"active","ownerRole":"project_manager","exitGates":["all_tasks_closed","all_snags_closed"]},
    {"key":"handover","visibleName":"Handover","description":"Complete acceptance, care information and final reconciliation.","phase":"handover","ownerRole":"project_manager","exitGates":["all_handovers_accepted","finance_closed"]},
    {"key":"completed","visibleName":"Completed","description":"Keep the closed order as an auditable record.","phase":"completed","ownerRole":null,"exitGates":[]}
  ]}
}'::jsonb, true),
('firm_kit', 'blank', 2, '{
  "label":"Blank",
  "applicableJobSections":["overview","scope","quote","agreement","delivery","handover","money","files","timeline"],
  "projectWorkflow":{"version":1,"code":"blank_delivery","name":"Blank delivery","description":"A neutral starting point that adds no design, factory or site-specific stages.","isDefault":true,"stages":[
    {"key":"planning","visibleName":"Planning","description":"Confirm ownership and plan only the work that applies.","phase":"planning","ownerRole":"project_manager","exitGates":["project_manager_assigned","tasks_planned"]},
    {"key":"work","visibleName":"Work","description":"Coordinate the configured work and its quality records.","phase":"active","ownerRole":"project_manager","exitGates":["all_tasks_closed","all_snags_closed"]},
    {"key":"closeout","visibleName":"Closeout","description":"Complete configured acceptance and financial reconciliation.","phase":"handover","ownerRole":"project_manager","exitGates":["all_handovers_accepted","finance_closed"]},
    {"key":"completed","visibleName":"Completed","description":"Keep the closed work as an auditable record.","phase":"completed","ownerRole":null,"exitGates":[]}
  ]}
}'::jsonb, true)
ON CONFLICT (kind, code, version) DO NOTHING;
