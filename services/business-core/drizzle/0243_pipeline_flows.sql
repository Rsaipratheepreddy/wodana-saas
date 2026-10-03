-- A step-by-step sales pipeline driven by the enquiry type's flow (PLM-121, PLM-122).
--   * Each enquiry type carries a flow (furniture, design, fit_out or basic; none = basic). The flow decides what
--     must exist in real records before an opportunity moves to the next column. Existing types get a suggested
--     flow from their code; an administrator changes it in Settings › Enquiry options.
--   * A "Qualified" column sits between New Opportunity and Proposal in the default Sales pipeline. Existing
--     pipelines built from the default template get it, with later columns shifted one place.
--   * Furniture opportunities record their sub-path, the factory's feasibility confirmation (bespoke), whether
--     materials change (core collection), and a client decision given on the spot, each with who and when.
--   * Payment proofs are attached to the opportunity (an immutable file record); Won needs one.
-- Runs as the migration owner, so forced RLS is never disabled. The new table gets forced RLS and the
-- tenant_isolation policy. Idempotent.
ALTER TABLE crm_taxonomy_options ADD COLUMN IF NOT EXISTS flow varchar(16);
--> statement-breakpoint
ALTER TABLE crm_taxonomy_options DROP CONSTRAINT IF EXISTS crm_taxonomy_options_flow_check;
--> statement-breakpoint
ALTER TABLE crm_taxonomy_options ADD CONSTRAINT crm_taxonomy_options_flow_check CHECK (flow IS NULL OR flow IN ('furniture', 'design', 'fit_out', 'basic'));
--> statement-breakpoint
UPDATE crm_taxonomy_options choice
   SET flow = CASE
         WHEN choice.code ~ 'furniture' AND choice.code !~ 'design' THEN 'furniture'
         WHEN choice.code ~ '(design|concept)' THEN 'design'
         WHEN choice.code ~ '(fit_?out|renovation|joinery)' THEN 'fit_out'
         ELSE 'basic' END,
       version = choice.version + 1, updated_at = now()
  FROM crm_taxonomies taxonomy
 WHERE taxonomy.workspace_id = choice.workspace_id AND taxonomy.id = choice.taxonomy_id
   AND taxonomy.code = 'enquiry_type' AND choice.flow IS NULL AND choice.code <> 'not_sure';
--> statement-breakpoint
ALTER TABLE crm_opportunities
  ADD COLUMN IF NOT EXISTS furniture_path varchar(30),
  ADD COLUMN IF NOT EXISTS feasibility_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS feasibility_confirmed_by uuid REFERENCES users (id),
  ADD COLUMN IF NOT EXISTS materials_change boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_approved_by uuid REFERENCES users (id);
--> statement-breakpoint
ALTER TABLE crm_opportunities DROP CONSTRAINT IF EXISTS crm_opportunities_furniture_path_check;
--> statement-breakpoint
ALTER TABLE crm_opportunities ADD CONSTRAINT crm_opportunities_furniture_path_check CHECK (furniture_path IS NULL OR furniture_path IN
  ('take_home_now', 'in_stock_delivery', 'supplier_order', 'core_collection_factory', 'bespoke'));
--> statement-breakpoint
ALTER TABLE crm_opportunities DROP CONSTRAINT IF EXISTS crm_opportunities_feasibility_check;
--> statement-breakpoint
ALTER TABLE crm_opportunities ADD CONSTRAINT crm_opportunities_feasibility_check CHECK ((feasibility_confirmed_at IS NULL) = (feasibility_confirmed_by IS NULL));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_opportunity_payment_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK (kind IN ('receipt', 'card_slip', 'bank_transfer', 'cash_sheet', 'photo', 'other')),
  storage_key text NOT NULL,
  file_name varchar(240) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  digest char(64) NOT NULL,
  has_preview boolean NOT NULL DEFAULT false,
  note varchar(1000),
  recorded_by uuid NOT NULL REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_opportunity_payment_proofs_idx ON crm_opportunity_payment_proofs (workspace_id, opportunity_id, recorded_at DESC);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE crm_opportunity_payment_proofs ENABLE ROW LEVEL SECURITY;
  ALTER TABLE crm_opportunity_payment_proofs FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'crm_opportunity_payment_proofs' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON crm_opportunity_payment_proofs
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON crm_opportunity_payment_proofs TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- The Qualified column for pipelines built from the default template (New Opportunity → Proposal → …).
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT pipeline.workspace_id, pipeline.id AS pipeline_id, proposal.position AS at
      FROM crm_pipelines pipeline
      JOIN crm_pipeline_stages first_stage ON first_stage.workspace_id = pipeline.workspace_id AND first_stage.pipeline_id = pipeline.id AND first_stage.code = 'qualified'
      JOIN crm_pipeline_stages proposal ON proposal.workspace_id = pipeline.workspace_id AND proposal.pipeline_id = pipeline.id AND proposal.code = 'proposal'
     WHERE first_stage.position < proposal.position
       AND NOT EXISTS (SELECT 1 FROM crm_pipeline_stages existing
                        WHERE existing.workspace_id = pipeline.workspace_id AND existing.pipeline_id = pipeline.id AND existing.code = 'qualification')
  LOOP
    UPDATE crm_pipeline_stages SET position = position + 100000
     WHERE workspace_id = target.workspace_id AND pipeline_id = target.pipeline_id AND position >= target.at;
    UPDATE crm_pipeline_stages SET position = position - 100000 + 1, version = version + 1, updated_at = now()
     WHERE workspace_id = target.workspace_id AND pipeline_id = target.pipeline_id AND position >= 100000 + target.at;
    INSERT INTO crm_pipeline_stages (workspace_id, pipeline_id, code, name, position, probability, forecast_category, entry_requirements)
    VALUES (target.workspace_id, target.pipeline_id, 'qualification', 'Qualified', target.at, 35, 'pipeline', '{}'::jsonb);
  END LOOP;
END $$;
--> statement-breakpoint
-- Firm kits that carry the default template get the same column, so new workspaces start with it.
DO $$
DECLARE kit record;
BEGIN
  FOR kit IN
    SELECT profile.kind, profile.code, profile.version, (item->>'position')::int AS at
      FROM tenant_setup_profiles profile
      CROSS JOIN LATERAL jsonb_array_elements(profile.configuration->'salesPipeline'->'stages') item
     WHERE profile.kind = 'firm_kit' AND item->>'code' = 'proposal'
       AND profile.configuration->'salesPipeline'->'stages' @> '[{"code": "qualified"}]'::jsonb
       AND NOT profile.configuration->'salesPipeline'->'stages' @> '[{"code": "qualification"}]'::jsonb
  LOOP
    UPDATE tenant_setup_profiles profile
       SET configuration = jsonb_set(profile.configuration, '{salesPipeline,stages}', (
         SELECT jsonb_agg(stage ORDER BY (stage->>'position')::int)
           FROM (
             SELECT CASE WHEN (item->>'position')::int >= kit.at
                         THEN jsonb_set(item, '{position}', to_jsonb((item->>'position')::int + 1)) ELSE item END AS stage
               FROM jsonb_array_elements(profile.configuration->'salesPipeline'->'stages') item
             UNION ALL
             SELECT jsonb_build_object('code', 'qualification', 'name', 'Qualified', 'position', kit.at, 'probability', 35,
                                       'forecastCategory', 'pipeline', 'entryRequirements', '{}'::jsonb)
           ) stages))
     WHERE profile.kind = kit.kind AND profile.code = kit.code AND profile.version = kit.version;
  END LOOP;
END $$;
