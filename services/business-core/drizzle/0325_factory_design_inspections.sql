-- Design inspections at the factory (PLM-150, a change to PLM-063 / PLM-064).
--
-- 1. workspace_factory_settings: whether made items get design inspections, which stages (Inspection 1 in raw material
--    before the final finish, Inspection 2 after finishing; one or both, in the firm's words), which trades need them
--    (none listed: every item made in the factory), the project role that inspects (and the role that inspects on
--    projects of the listed design packages instead), and the working days an inspection is due in. Configuration.
-- 2. work_orders.inspection_stages: the stages a work order needs, fixed when it is planned and again when it starts.
--    NULL for work orders from before this change: nothing is asked of them, so nothing is blocked retroactively.
-- 3. factory_inspections: one row per round of an inspection (the factory marks the item ready; the inspecting
--    designer passes or fails it). A failed round opens snags for the factory; once they are fixed the item comes back
--    for the next round. One round open per work order and stage. The factory person who asked can't record it.
-- 4. factory_inspection_photos: the photos taken at a round (a failed round needs at least one).
-- 5. work_items.factory_inspection_id: the round a snag came from (its rectification task for the factory).
-- Every new table has workspace_id, forced RLS and a tenant_isolation policy. Idempotent; never disables RLS.
ALTER TABLE workspace_factory_settings
  ADD COLUMN IF NOT EXISTS inspections_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS inspection_stages jsonb NOT NULL DEFAULT '[{"kind": "raw", "label": ""}, {"kind": "final", "label": ""}]'::jsonb,
  ADD COLUMN IF NOT EXISTS inspection_work_packages uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS inspector_role varchar(60) NOT NULL DEFAULT 'designer',
  ADD COLUMN IF NOT EXISTS director_role varchar(60),
  ADD COLUMN IF NOT EXISTS director_packages varchar(40)[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS inspection_days smallint NOT NULL DEFAULT 2;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_factory_settings_inspection_stages_check') THEN
    ALTER TABLE workspace_factory_settings ADD CONSTRAINT workspace_factory_settings_inspection_stages_check CHECK (jsonb_typeof(inspection_stages) = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_factory_settings_inspection_days_check') THEN
    ALTER TABLE workspace_factory_settings ADD CONSTRAINT workspace_factory_settings_inspection_days_check CHECK (inspection_days BETWEEN 1 AND 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_factory_settings_inspector_role_check') THEN
    ALTER TABLE workspace_factory_settings ADD CONSTRAINT workspace_factory_settings_inspector_role_check
      CHECK (inspector_role ~ '^[a-z][a-z0-9_]{0,59}$' AND (director_role IS NULL OR director_role ~ '^[a-z][a-z0-9_]{0,59}$'));
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS inspection_stages varchar(10)[];
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_orders_inspection_stages_check') THEN
    ALTER TABLE work_orders ADD CONSTRAINT work_orders_inspection_stages_check CHECK (inspection_stages IS NULL OR inspection_stages <@ ARRAY['raw', 'final']::varchar[]);
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS factory_inspections (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  project_id uuid NOT NULL,
  stage varchar(10) NOT NULL CHECK (stage IN ('raw', 'final')),
  round smallint NOT NULL CHECK (round > 0),
  status varchar(10) NOT NULL DEFAULT 'due' CHECK (status IN ('due', 'passed', 'failed', 'cancelled')),
  -- Who marked the item ready (the factory) and when; the working day it is due.
  requested_by uuid NOT NULL REFERENCES users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  due_on date NOT NULL,
  -- Who it went to, by which project role (null: nobody on the team holds an inspecting role).
  inspector_membership_id uuid,
  inspector_role varchar(60),
  result_by uuid REFERENCES users (id),
  result_at timestamptz,
  comments varchar(2000) NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, work_order_id, stage, round),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, inspector_membership_id) REFERENCES workspace_memberships (workspace_id, id),
  CHECK ((status IN ('passed', 'failed')) = (result_at IS NOT NULL AND result_by IS NOT NULL)),
  CHECK (status <> 'failed' OR length(btrim(comments)) > 0),
  -- The factory never passes its own inspection.
  CHECK (result_by IS NULL OR result_by <> requested_by)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS factory_inspections_one_open ON factory_inspections (workspace_id, work_order_id, stage) WHERE status = 'due';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS factory_inspections_due_idx ON factory_inspections (workspace_id, due_on) WHERE status = 'due';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS factory_inspections_project_idx ON factory_inspections (workspace_id, project_id, work_order_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS factory_inspection_photos (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  work_order_id uuid NOT NULL,
  original_name varchar(240) NOT NULL,
  mime_type varchar(80) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  object_key varchar(300) NOT NULL,
  preview_key varchar(300),
  sha256 char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, inspection_id) REFERENCES factory_inspections (workspace_id, id),
  FOREIGN KEY (workspace_id, work_order_id) REFERENCES work_orders (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS factory_inspection_photos_round_idx ON factory_inspection_photos (workspace_id, inspection_id);
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS factory_inspection_id uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_factory_inspection_fk') THEN
    ALTER TABLE work_items ADD CONSTRAINT work_items_factory_inspection_fk FOREIGN KEY (workspace_id, factory_inspection_id) REFERENCES factory_inspections (workspace_id, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_items_factory_inspection_snag_check') THEN
    ALTER TABLE work_items ADD CONSTRAINT work_items_factory_inspection_snag_check CHECK (factory_inspection_id IS NULL OR type = 'snag');
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS work_items_factory_inspection_idx ON work_items (workspace_id, factory_inspection_id) WHERE factory_inspection_id IS NOT NULL;
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['factory_inspections', 'factory_inspection_photos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = name AND policyname = 'tenant_isolation') THEN
      EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
        USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
        WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON factory_inspections TO wodana_app;
    GRANT SELECT, INSERT ON factory_inspection_photos TO wodana_app;
  END IF;
END $$;
