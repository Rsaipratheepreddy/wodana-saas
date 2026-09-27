-- What a work order uses. Each material is a stock item and a quantity (suggested from the project's
-- material list when a material is used only on the work order's line). Stock is issued to the work
-- order from the project's stock or free stock and can come back; a work order is released only when
-- each material is issued or the project's stock covers it. Swapping a material for another waits for
-- someone else's approval.
CREATE TABLE work_order_materials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  item_id uuid NOT NULL,
  material_item_id uuid,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'replaced', 'refused', 'removed')),
  replaces_id uuid,
  reason varchar(500) NOT NULL DEFAULT '',
  requested_by uuid NOT NULL REFERENCES users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  decision_note varchar(500) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES stock_items (workspace_id, id),
  FOREIGN KEY (workspace_id, material_item_id) REFERENCES project_material_items (workspace_id, id),
  FOREIGN KEY (workspace_id, replaces_id) REFERENCES work_order_materials (workspace_id, id),
  -- A swap says why, and whoever asked for it doesn't decide it.
  CHECK (replaces_id IS NULL OR length(btrim(reason)) > 0),
  CHECK (status NOT IN ('pending', 'refused') OR replaces_id IS NOT NULL),
  CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CHECK (status <> 'refused' OR length(btrim(decision_note)) > 0)
);
--> statement-breakpoint
CREATE INDEX work_order_materials_order_idx ON work_order_materials (workspace_id, work_order_id);
--> statement-breakpoint
ALTER TABLE stock_movements ADD COLUMN work_order_material_id uuid;
--> statement-breakpoint
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_work_order_material_check CHECK (work_order_material_id IS NULL OR (work_order_id IS NOT NULL AND kind IN ('issue', 'return')));
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'ALTER TABLE work_order_materials ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE work_order_materials FORCE ROW LEVEL SECURITY';
  EXECUTE $policy$CREATE POLICY tenant_isolation ON work_order_materials
    USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
    WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON work_order_materials TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('factory.material_short', 'in_app', '{{order}} is waiting for materials', '{{project}}: {{note}}', '["order", "item", "project", "actor", "note"]'),
  ('factory.substitution', 'in_app', 'A material swap on {{order}} needs your decision', '{{actor}}: {{note}}', '["order", "item", "project", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
