-- §0.3 P0: an "Intro booked" column between New Opportunity and Qualified in the default Sales pipeline. Booking the
-- intro moves the opportunity there. Existing pipelines built from the default template get it, with later columns
-- shifted one place; firm kits that carry the default template get it too, so new workspaces start with it. Runs as
-- the migration owner, so forced RLS is never disabled. Idempotent.
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT pipeline.workspace_id, pipeline.id AS pipeline_id, qualification.position AS at
      FROM crm_pipelines pipeline
      JOIN crm_pipeline_stages first_stage ON first_stage.workspace_id = pipeline.workspace_id AND first_stage.pipeline_id = pipeline.id AND first_stage.code = 'qualified'
      JOIN crm_pipeline_stages qualification ON qualification.workspace_id = pipeline.workspace_id AND qualification.pipeline_id = pipeline.id AND qualification.code = 'qualification'
     WHERE first_stage.position < qualification.position
       AND NOT EXISTS (SELECT 1 FROM crm_pipeline_stages existing
                        WHERE existing.workspace_id = pipeline.workspace_id AND existing.pipeline_id = pipeline.id AND existing.code = 'intro_booked')
  LOOP
    UPDATE crm_pipeline_stages SET position = position + 100000
     WHERE workspace_id = target.workspace_id AND pipeline_id = target.pipeline_id AND position >= target.at;
    UPDATE crm_pipeline_stages SET position = position - 100000 + 1, version = version + 1, updated_at = now()
     WHERE workspace_id = target.workspace_id AND pipeline_id = target.pipeline_id AND position >= 100000 + target.at;
    INSERT INTO crm_pipeline_stages (workspace_id, pipeline_id, code, name, position, probability, forecast_category, entry_requirements)
    VALUES (target.workspace_id, target.pipeline_id, 'intro_booked', 'Intro booked', target.at, 25, 'pipeline', '{}'::jsonb);
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE kit record;
BEGIN
  FOR kit IN
    SELECT profile.kind, profile.code, profile.version, (item->>'position')::int AS at
      FROM tenant_setup_profiles profile
      CROSS JOIN LATERAL jsonb_array_elements(profile.configuration->'salesPipeline'->'stages') item
     WHERE profile.kind = 'firm_kit' AND item->>'code' = 'qualification'
       AND profile.configuration->'salesPipeline'->'stages' @> '[{"code": "qualified"}]'::jsonb
       AND NOT profile.configuration->'salesPipeline'->'stages' @> '[{"code": "intro_booked"}]'::jsonb
  LOOP
    UPDATE tenant_setup_profiles profile
       SET configuration = jsonb_set(profile.configuration, '{salesPipeline,stages}', (
         SELECT jsonb_agg(stage ORDER BY (stage->>'position')::int)
           FROM (
             SELECT CASE WHEN (item->>'position')::int >= kit.at
                         THEN jsonb_set(item, '{position}', to_jsonb((item->>'position')::int + 1)) ELSE item END AS stage
               FROM jsonb_array_elements(profile.configuration->'salesPipeline'->'stages') item
             UNION ALL
             SELECT jsonb_build_object('code', 'intro_booked', 'name', 'Intro booked', 'position', kit.at, 'probability', 25,
                                       'forecastCategory', 'pipeline', 'entryRequirements', '{}'::jsonb)
           ) stages))
     WHERE profile.kind = kit.kind AND profile.code = kit.code AND profile.version = kit.version;
  END LOOP;
END $$;
