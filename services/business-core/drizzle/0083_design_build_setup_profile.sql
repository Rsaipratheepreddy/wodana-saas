ALTER TABLE tenant_setup_profiles ADD COLUMN selectable boolean DEFAULT true NOT NULL;
UPDATE tenant_setup_profiles SET selectable = false WHERE kind = 'firm_kit' AND version = 1;
--> statement-breakpoint
INSERT INTO tenant_setup_profiles (kind, code, version, configuration, selectable)
VALUES ('firm_kit', 'design_build', 2, '{
  "label": "Design & build",
  "projectWorkflow": {
    "version": 1,
    "code": "standard_delivery",
    "name": "Standard project delivery",
    "description": "A neutral project lifecycle. Detailed work packages can overlap inside Delivery.",
    "isDefault": true,
    "stages": [
      {"key":"planning","visibleName":"Planning","description":"Confirm ownership and turn the released scope into executable work.","phase":"planning","ownerRole":"project_manager","exitGates":["project_manager_assigned","tasks_planned"]},
      {"key":"delivery","visibleName":"Delivery","description":"Coordinate design, sourcing, production and site work as overlapping work packages.","phase":"active","ownerRole":"project_manager","exitGates":["all_tasks_closed","all_snags_closed"]},
      {"key":"handover","visibleName":"Handover","description":"Complete client acceptance and financial reconciliation.","phase":"handover","ownerRole":"project_manager","exitGates":["all_handovers_accepted","finance_closed"]},
      {"key":"completed","visibleName":"Completed","description":"Keep the closed project available as an auditable record.","phase":"completed","ownerRole":null,"exitGates":[]}
    ]
  }
}'::jsonb, true);
