-- Capacity and batches. A work order can carry the hours it takes; spread over its working days, the
-- hours on each workcenter each day show where the factory is over what it can do. A batch groups
-- work orders from any projects into one run (one cutting run for three kitchens) — each keeps its own
-- project, output and checks; starting the batch starts its released work orders.
ALTER TABLE work_orders ADD COLUMN planned_hours numeric(8, 2) CHECK (planned_hours IS NULL OR planned_hours > 0);
--> statement-breakpoint
CREATE TABLE production_batches (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  workcenter_id uuid,
  planned_on date,
  status varchar(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'started', 'closed')),
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, workcenter_id) REFERENCES workcenters (workspace_id, id)
);
--> statement-breakpoint
ALTER TABLE work_orders ADD COLUMN batch_id uuid;
--> statement-breakpoint
ALTER TABLE work_orders ADD CONSTRAINT work_orders_batch_fkey FOREIGN KEY (workspace_id, batch_id) REFERENCES production_batches (workspace_id, id);
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE production_batches FORCE ROW LEVEL SECURITY';
  EXECUTE $policy$CREATE POLICY tenant_isolation ON production_batches
    USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
    WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON production_batches TO wodana_app;
  END IF;
END $$;
