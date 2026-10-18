-- Purchasing: materials ready, and supplier tax numbers in the country's format.
--
-- 1. PLM-074: when everything a project buys is in (received, from stock or installed), its manager and
--    production lead hear once for that set of lines. One row per project and set (a fingerprint of the
--    lines and their quantities); only the transaction that writes it tells anyone. Lines added later
--    (a variation) make a new set. Workspace-scoped, forced RLS, tenant_isolation; history, never edited.
-- 2. The notice templates (in the app and by email) for every workspace.
-- 3. PLM-111: where a country writes its tax registration number in one fixed format, its region pack
--    says so (pattern and an example); a supplier's new or changed number is checked against it.
--    Countries without one fixed format (or without sales tax) have none. Facts, not tenant choices.
-- PLM-072 (each line's Required → Ordered → Received → Installed) is derived from orders, receipts,
-- stock and approved site reports, so it needs no column. Idempotent; never disables RLS.
CREATE TABLE IF NOT EXISTS project_materials_ready (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  fingerprint char(64) NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  lines integer NOT NULL CHECK (lines > 0),
  recorded_by uuid REFERENCES users (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, project_id, fingerprint),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE project_materials_ready ENABLE ROW LEVEL SECURITY;
  ALTER TABLE project_materials_ready FORCE ROW LEVEL SECURITY;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_materials_ready' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON project_materials_ready
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON project_materials_ready TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('purchasing.materials_ready', 'in_app', 'Materials are in for {{project}}', 'All {{lines}} lines are received.', '["project","lines"]'),
  ('purchasing.materials_ready', 'email', 'Materials are in for {{project}}', E'Everything {{project}} buys is received: {{lines}} lines.\n\nPlan production and site work.', '["project","lines"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
UPDATE tenant_setup_profiles profile
   SET configuration = jsonb_set(profile.configuration, '{tax,registrationFormat}', format.rule)
  FROM (VALUES
    ('AE', '{"pattern": "^[0-9]{15}$", "example": "100123456700003"}'::jsonb),
    ('SA', '{"pattern": "^3[0-9]{13}3$", "example": "300123456700003"}'::jsonb),
    ('BH', '{"pattern": "^[0-9]{15}$", "example": "200012345600002"}'::jsonb),
    ('OM', '{"pattern": "^OM[0-9]{10}$", "example": "OM1100012345"}'::jsonb),
    ('IN', '{"pattern": "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$", "example": "27AAPFU0939F1ZV"}'::jsonb),
    ('GB', '{"pattern": "^(GB)?([0-9]{9}|[0-9]{12}|GD[0-9]{3}|HA[0-9]{3})$", "example": "GB123456789"}'::jsonb),
    ('AU', '{"pattern": "^[0-9]{11}$", "example": "51824753556"}'::jsonb)
  ) AS format (code, rule)
 WHERE profile.kind = 'region' AND profile.code = format.code AND jsonb_typeof(profile.configuration->'tax') = 'object';
