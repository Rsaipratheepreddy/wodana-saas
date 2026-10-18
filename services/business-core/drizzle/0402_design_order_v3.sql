-- Guide steps 1–11 (agreed 16 Oct 2026): the design order every package runs from now on. Inspiration, kick-off,
-- mood boards (two options the client chooses between in the portal), space planning (a PDF, no client approval,
-- after the site measure), the 2D concept, 3D renders when the package has them, the material selection on jobs that
-- include it, a final render only when the client asks, then the design approval. Journeys started before keep the
-- order they started in (flow 1 or 2). Whether a job has the material selection is the firm's configuration: a job
-- area ("selection") next to planning, production, supply and delivery, frozen on the journey when it starts.
-- Constraint changes only; idempotent; never disables RLS.
ALTER TABLE design_journeys DROP CONSTRAINT IF EXISTS design_journeys_flow_version_check;
--> statement-breakpoint
ALTER TABLE design_journeys ADD CONSTRAINT design_journeys_flow_version_check CHECK (flow_version = ANY (ARRAY[1, 2, 3]));
--> statement-breakpoint
ALTER TABLE design_journeys ADD COLUMN IF NOT EXISTS material_selection boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE design_journey_stages DROP CONSTRAINT IF EXISTS design_journey_stages_stage_check;
--> statement-breakpoint
ALTER TABLE design_journey_stages ADD CONSTRAINT design_journey_stages_stage_check CHECK (stage::text = ANY (ARRAY['inspiration', 'kickoff', 'site_visit', 'moodboards', 'concepts',
  'space_planning', 'material_selection', 'renders', 'samples', 'final_render', 'approval']::text[]));
--> statement-breakpoint
ALTER TABLE design_presentations DROP CONSTRAINT IF EXISTS design_presentations_stage_check;
--> statement-breakpoint
ALTER TABLE design_presentations ADD CONSTRAINT design_presentations_stage_check CHECK (stage::text = ANY (ARRAY['moodboards', 'concepts', 'space_planning', 'material_selection', 'renders']::text[]));
--> statement-breakpoint
ALTER TABLE pre_project_designs DROP CONSTRAINT IF EXISTS pre_project_designs_stage_check;
--> statement-breakpoint
ALTER TABLE pre_project_designs ADD CONSTRAINT pre_project_designs_stage_check CHECK (stage IS NULL OR stage::text = ANY (ARRAY['moodboards', 'space_planning', 'concepts', 'material_selection', 'renders']::text[]));
--> statement-breakpoint
ALTER TABLE crm_flow_won_areas DROP CONSTRAINT IF EXISTS crm_flow_won_areas_areas_check;
--> statement-breakpoint
ALTER TABLE crm_flow_won_areas ADD CONSTRAINT crm_flow_won_areas_areas_check CHECK (areas <@ ARRAY['planning', 'production', 'supply', 'delivery', 'selection']::text[]);
