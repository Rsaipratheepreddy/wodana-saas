-- Factory v2: what the site sends back, rework, and drawings picked from the project's approved designs.
--
-- 1. Made goods rejected when a factory dispatch arrives at site: the move's line keeps how much was
--    rejected and why; a return trip (a move back to the factory, linked to the dispatch) takes them back.
-- 2. Rework: what came back (or anything else sent back to be made again) reopens its work order for that
--    quantity. What passed before stays in its checks; the work order counts it once.
-- 3. A work order's approved drawing can be a design deliverable's revision from the project's case, so a
--    newer revision is noticed.
-- Every new table has workspace_id, forced RLS and a tenant_isolation policy.
ALTER TABLE stock_transfer_lines
  ADD COLUMN rejected numeric(18, 4) NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  ADD COLUMN reject_reason varchar(500) NOT NULL DEFAULT '',
  ADD CONSTRAINT stock_transfer_lines_rejected_arrived CHECK (rejected = 0 OR (received IS NOT NULL AND rejected <= received)),
  ADD CONSTRAINT stock_transfer_lines_rejected_reason CHECK (rejected = 0 OR length(btrim(reject_reason)) > 0);
--> statement-breakpoint
ALTER TABLE stock_transfers
  ADD COLUMN returned_from_id uuid,
  ADD CONSTRAINT stock_transfers_returned_from FOREIGN KEY (workspace_id, returned_from_id) REFERENCES stock_transfers (workspace_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_transfers_one_return ON stock_transfers (workspace_id, returned_from_id) WHERE returned_from_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE work_order_reworks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) > 0),
  -- Where it came from: rejected at site on a dispatch (and the trip back), or sent back by hand.
  source varchar(10) NOT NULL CHECK (source IN ('site', 'factory')),
  dispatch_id uuid,
  return_id uuid,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, dispatch_id) REFERENCES stock_transfers (workspace_id, id),
  FOREIGN KEY (workspace_id, return_id) REFERENCES stock_transfers (workspace_id, id),
  CHECK ((source = 'site') = (dispatch_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX work_order_reworks_order_idx ON work_order_reworks (workspace_id, work_order_id);
--> statement-breakpoint
ALTER TABLE work_orders
  ADD COLUMN drawing_design_id uuid REFERENCES pre_project_designs (id),
  ADD COLUMN drawing_version_id uuid REFERENCES pre_project_design_versions (id),
  -- When the daily run stopped it because a newer revision of its drawing exists (once per revision).
  ADD COLUMN drawing_stale_version_id uuid REFERENCES pre_project_design_versions (id),
  ADD CONSTRAINT work_orders_drawing_pick CHECK ((drawing_design_id IS NULL) = (drawing_version_id IS NULL));
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE work_order_reworks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE work_order_reworks FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON work_order_reworks
    USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
    WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT ON work_order_reworks TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('factory.rework', '{{order}} goes back into production', '{{note}}', '["order", "item", "project", "actor", "note"]'),
  ('factory.drawing_stale', '{{order}}: its drawing has a newer revision', '{{note}}', '["order", "item", "project", "actor", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
