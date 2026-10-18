-- PLM-043 / PLM-088: the intro meeting is booked in a designer's calendar from the opportunity, and that
-- designer becomes the opportunity's dedicated designer. Changing the designer later needs a reason and
-- a CRM owner or admin; every change is kept.
CREATE TABLE crm_opportunity_designer (
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES workspace_memberships (id),
  intro_activity_id uuid REFERENCES crm_activities (id) ON DELETE SET NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, opportunity_id)
);
--> statement-breakpoint
CREATE TABLE crm_opportunity_designer_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES crm_opportunities (id) ON DELETE CASCADE,
  from_membership_id uuid REFERENCES workspace_memberships (id),
  to_membership_id uuid NOT NULL REFERENCES workspace_memberships (id),
  reason text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX crm_opportunity_designer_history_idx ON crm_opportunity_designer_history (workspace_id, opportunity_id, changed_at DESC);
--> statement-breakpoint
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['crm_opportunity_designer', 'crm_opportunity_designer_history'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$p$, table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO wodana_app', table_name);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.intro_booked', 'in_app', 'en', 1, 'approved',
  '{{meeting}} with {{clientName}}',
  '{{when}} · {{place}}. Booked by {{bookedBy}}.',
  '["meeting","clientName","when","place","bookedBy"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.intro_booked', 'email', 'en', 1, 'approved',
  'Invitation: {{meeting}} with {{clientName}}',
  E'{{meeting}} with {{clientName}}\n\nWhen: {{when}}\nWhere: {{place}}\nBooked by: {{bookedBy}}\n\nThe floor plan and the client''s details are on the opportunity.',
  '["meeting","clientName","when","place","bookedBy"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'crm.designer_assigned', 'in_app', 'en', 1, 'approved',
  'You are the designer for {{clientName}}',
  '{{changedBy}} made you the dedicated designer. Reason: {{reason}}',
  '["clientName","changedBy","reason"]'::jsonb, now()
FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
