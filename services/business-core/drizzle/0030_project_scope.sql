-- Project scope: the live BOQ (the sealed baseline plus accepted variations), packages (a wardrobe, the
-- kitchen joinery, the living-room ceiling) and each line's history. Every later record — materials,
-- orders, production, deliveries, installation, snags, warranty — points at a BOQ line.

-- A package: one piece of scope delivered one way (made in the factory, bought, subcontracted…).
CREATE TABLE project_packages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  area_id uuid,
  supply varchar(12) NOT NULL CHECK (supply IN ('make', 'buy', 'ready_made', 'subcontract', 'client', 'site_work')),
  owner_membership_id uuid,
  due_date date,
  position integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, owner_membership_id) REFERENCES workspace_memberships (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX project_packages_project_idx ON project_packages (workspace_id, project_id, position);
--> statement-breakpoint
-- A live BOQ line. It comes from a sealed quotation (baseline or variation) and keeps that origin.
CREATE TABLE project_boq_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  position integer NOT NULL DEFAULT 0,
  origin_seal_id uuid NOT NULL,
  source_line_id text NOT NULL,
  kind varchar(24) NOT NULL,
  area_id uuid,
  work_package_id uuid,
  title varchar(300) NOT NULL,
  description text NOT NULL DEFAULT '',
  unit varchar(40) NOT NULL DEFAULT '',
  quantity numeric(18, 4) NOT NULL,
  rate numeric(18, 4) NOT NULL,
  net numeric(18, 4) NOT NULL,
  catalog_item_id uuid,
  catalog_image_id uuid,
  image_asset_id uuid,
  package_id uuid,
  status varchar(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'omitted')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, project_id, origin_seal_id, source_line_id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, origin_seal_id) REFERENCES project_scope_seals (workspace_id, id),
  FOREIGN KEY (workspace_id, package_id) REFERENCES project_packages (workspace_id, id) ON DELETE SET NULL (package_id),
  CHECK (status = 'omitted' OR quantity > 0)
);
--> statement-breakpoint
CREATE INDEX project_boq_lines_project_idx ON project_boq_lines (workspace_id, project_id, position);
--> statement-breakpoint
CREATE INDEX project_boq_lines_package_idx ON project_boq_lines (workspace_id, package_id);
--> statement-breakpoint
-- What happened to a line, oldest first: agreed, added, reduced, omitted, moved, packaged, signed off… Never edited.
CREATE TABLE project_boq_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  line_id uuid NOT NULL,
  kind varchar(24) NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object'),
  seal_id uuid,
  actor_user_id uuid,
  -- The clock time of each insert, so entries written in one transaction keep their order.
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (workspace_id, line_id) REFERENCES project_boq_lines (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX project_boq_events_line_idx ON project_boq_events (workspace_id, line_id, at);
--> statement-breakpoint
CREATE FUNCTION project_boq_events_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A line''s history cannot be changed.';
END $$;
--> statement-breakpoint
CREATE TRIGGER project_boq_events_no_update BEFORE UPDATE ON project_boq_events
FOR EACH ROW EXECUTE FUNCTION project_boq_events_immutable();
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_packages', 'project_boq_lines', 'project_boq_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON project_packages, project_boq_lines TO wodana_app;
    GRANT SELECT, INSERT ON project_boq_events TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
-- Projects started before this migration get their live BOQ from the sealed baseline.
INSERT INTO project_boq_lines (id, workspace_id, project_id, position, origin_seal_id, source_line_id, kind, area_id, work_package_id, title, description,
  unit, quantity, rate, net, catalog_item_id, catalog_image_id, image_asset_id)
SELECT gen_random_uuid(), seal.workspace_id, seal.project_id, (line.value->>'position')::int, seal.id, line.value->>'id', line.value->>'kind',
  NULLIF(line.value->>'areaId', '')::uuid, NULLIF(line.value->>'workPackageId', '')::uuid, line.value->>'title', coalesce(line.value->>'description', ''),
  coalesce(line.value->>'unit', ''), (line.value->>'quantity')::numeric, (line.value->>'rate')::numeric, (line.value->>'net')::numeric,
  NULLIF(line.value->>'catalogItemId', '')::uuid, NULLIF(line.value->>'catalogImageId', '')::uuid, NULLIF(line.value->>'imageAssetId', '')::uuid
FROM project_scope_seals seal CROSS JOIN LATERAL jsonb_array_elements(seal.snapshot->'lines') line
WHERE seal.kind = 'baseline' AND (line.value->>'quantity')::numeric > 0;
--> statement-breakpoint
INSERT INTO project_boq_events (id, workspace_id, project_id, line_id, kind, detail, seal_id, actor_user_id, at)
SELECT gen_random_uuid(), boq.workspace_id, boq.project_id, boq.id, 'agreed', jsonb_build_object('revision', seal.revision_label, 'quantity', boq.quantity::text),
  seal.id, seal.sealed_by, seal.sealed_at
FROM project_boq_lines boq JOIN project_scope_seals seal ON seal.workspace_id = boq.workspace_id AND seal.id = boq.origin_seal_id;
