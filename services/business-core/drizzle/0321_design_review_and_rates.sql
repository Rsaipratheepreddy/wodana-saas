-- Design packages and reviews (PLM-139, PLM-144, PLM-145).
--   * design_packages.review_role_code: the role that reviews a package's concepts and renders before the client sees
--     them and chooses its lead designer (Palm: the Creative Director on "Designed by the Creative Director"). Packages
--     without one have no review. required_role_code keeps its meaning (the intro designer must hold it).
--   * design_packages.rate_from: the rate is a starting price ("from 100 per sq ft"); a higher rate agreed with the
--     client is approved through the approval engine (kind design_rate) before the fee uses it.
--   * design_packages.unit_definition: what one pricing unit is (Palm: "1 space = 1 room with a door").
--   * crm_opportunity_discovery.design_rate: the rate agreed with the client when it differs from the package's.
--   * design_ledger_versions.outsourced: a material from a local supplier instead of the firm's own stock or brands;
--     it counts only once approved through the approval engine (kind outsourced_material).
--   * design_presentations.reviewed_by / reviewed_at: the reviewer's approval of a round before the client sees it.
-- Idempotent; never disables RLS.
ALTER TABLE design_packages
  ADD COLUMN IF NOT EXISTS review_role_code varchar(60) CHECK (review_role_code IS NULL OR review_role_code ~ '^[a-z][a-z0-9_]{1,59}$'),
  ADD COLUMN IF NOT EXISTS rate_from boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS unit_definition varchar(200) CHECK (unit_definition IS NULL OR length(btrim(unit_definition)) > 0);
--> statement-breakpoint
ALTER TABLE crm_opportunity_discovery
  ADD COLUMN IF NOT EXISTS design_rate numeric(14, 2) CHECK (design_rate IS NULL OR design_rate > 0);
--> statement-breakpoint
ALTER TABLE design_ledger_versions
  ADD COLUMN IF NOT EXISTS outsourced boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE design_presentations
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE design_presentations ADD CONSTRAINT design_presentations_review_check CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('design.presentation_to_review', 'in_app', 'Review {{stage}} · {{clientName}}', '{{actor}} prepared it. Approve it before the client sees it.', '["stage","clientName","actor"]'),
  ('design.presentation_to_review', 'email', 'Please review: {{stage}} for {{clientName}}', E'{{actor}} prepared {{stage}} for {{clientName}}.\n\nApprove it before it goes to the client.', '["stage","clientName","actor"]'),
  ('design.presentation_reviewed', 'in_app', '{{stage}} approved · {{clientName}}', '{{actor}} approved it. Show it to the client.', '["stage","clientName","actor"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
