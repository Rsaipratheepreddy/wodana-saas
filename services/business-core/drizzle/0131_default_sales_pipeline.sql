-- Every workspace has a Sales pipeline from the day it is created, so a salesperson's first
-- conversion never depends on someone with the CRM-settings permission creating one. New workspaces
-- get the pipeline from their firm kit (`salesPipeline`, seeded here on the selectable kits); this
-- migration gives it to existing workspaces that have no usable pipeline (active, with an active
-- stage). A workspace that already has one is left alone. Runs as the migration owner, so forced RLS
-- is never disabled. Idempotent.
UPDATE tenant_setup_profiles
   SET configuration = configuration || jsonb_build_object('salesPipeline', '{"code": "sales", "name": "Sales", "stages": [{"code": "qualified", "name": "New Opportunity", "position": 1, "probability": 20, "forecastCategory": "pipeline", "entryRequirements": {"owner": true, "nextAction": true}}, {"code": "proposal", "name": "Proposal", "position": 2, "probability": 50, "forecastCategory": "best_case", "entryRequirements": {}}, {"code": "negotiation", "name": "Negotiation", "position": 3, "probability": 75, "forecastCategory": "commit", "entryRequirements": {}}, {"code": "won", "name": "Won", "position": 4, "probability": 100, "forecastCategory": "closed", "entryRequirements": {}}, {"code": "lost", "name": "Lost", "position": 5, "probability": 0, "forecastCategory": "closed", "entryRequirements": {}}]}'::jsonb)
 WHERE kind = 'firm_kit' AND selectable AND NOT (configuration ? 'salesPipeline');
--> statement-breakpoint
-- An archived "sales" pipeline in a workspace with nothing usable comes back as the default.
UPDATE crm_pipelines pipeline
   SET status = 'active', is_default = true, version = version + 1, updated_at = now()
 WHERE pipeline.code = 'sales' AND pipeline.status <> 'active'
   AND NOT EXISTS (SELECT 1 FROM crm_pipelines usable
                    WHERE usable.workspace_id = pipeline.workspace_id AND usable.status = 'active'
                      AND EXISTS (SELECT 1 FROM crm_pipeline_stages stage
                                   WHERE stage.workspace_id = usable.workspace_id AND stage.pipeline_id = usable.id AND stage.status = 'active'));
--> statement-breakpoint
INSERT INTO crm_pipelines (workspace_id, code, name, is_default, status)
SELECT workspace.id, 'sales', 'Sales', true, 'active'
  FROM workspaces workspace
 WHERE NOT EXISTS (SELECT 1 FROM crm_pipelines usable
                    WHERE usable.workspace_id = workspace.id AND usable.status = 'active'
                      AND EXISTS (SELECT 1 FROM crm_pipeline_stages stage
                                   WHERE stage.workspace_id = usable.workspace_id AND stage.pipeline_id = usable.id AND stage.status = 'active'))
ON CONFLICT (workspace_id, code) DO NOTHING;
--> statement-breakpoint
INSERT INTO crm_pipeline_stages (workspace_id, pipeline_id, code, name, position, probability, forecast_category, entry_requirements)
SELECT pipeline.workspace_id, pipeline.id, stage.code, stage.name, stage.position, stage.probability, stage.forecast_category, stage.entry_requirements::jsonb
  FROM crm_pipelines pipeline
 CROSS JOIN (VALUES
   ('qualified', 'New Opportunity', 1, 20, 'pipeline', '{"owner": true, "nextAction": true}'),
   ('proposal', 'Proposal', 2, 50, 'best_case', '{}'),
   ('negotiation', 'Negotiation', 3, 75, 'commit', '{}'),
   ('won', 'Won', 4, 100, 'closed', '{}'),
   ('lost', 'Lost', 5, 0, 'closed', '{}')
 ) AS stage (code, name, position, probability, forecast_category, entry_requirements)
 WHERE pipeline.code = 'sales' AND pipeline.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM crm_pipeline_stages existing
                    WHERE existing.workspace_id = pipeline.workspace_id AND existing.pipeline_id = pipeline.id)
ON CONFLICT DO NOTHING;
