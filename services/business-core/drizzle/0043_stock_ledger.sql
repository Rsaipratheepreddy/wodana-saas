-- Stock: what the firm holds, where, and for whom. Every change is an immutable movement; the balance
-- per item, location and owner (a project, or free stock when none) is kept by the database from the
-- movements in the same transaction and can never go below zero.
CREATE TABLE stock_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  catalog_item_id uuid,
  name varchar(240) NOT NULL CHECK (length(btrim(name)) > 0),
  unit varchar(40) NOT NULL DEFAULT '',
  code varchar(80) NOT NULL DEFAULT '',
  -- Items without a catalog item are told apart by name and unit.
  normal_key varchar(300) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, catalog_item_id) REFERENCES catalog_items (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_items_catalog ON stock_items (workspace_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX stock_items_named ON stock_items (workspace_id, normal_key) WHERE catalog_item_id IS NULL;
--> statement-breakpoint
CREATE TABLE stock_transfers (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  from_location_id uuid NOT NULL,
  to_location_id uuid NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'cancelled')),
  note varchar(500) NOT NULL DEFAULT '',
  sent_on date NOT NULL,
  sent_by uuid NOT NULL REFERENCES users (id),
  received_on date,
  received_by uuid REFERENCES users (id),
  cancel_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, number),
  FOREIGN KEY (workspace_id, from_location_id) REFERENCES stock_locations (workspace_id, id),
  FOREIGN KEY (workspace_id, to_location_id) REFERENCES stock_locations (workspace_id, id),
  CHECK (from_location_id <> to_location_id),
  CHECK ((status = 'received') = (received_on IS NOT NULL)),
  CHECK (status <> 'cancelled' OR length(btrim(cancel_reason)) > 0)
);
--> statement-breakpoint
CREATE TABLE stock_transfer_lines (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  transfer_id uuid NOT NULL,
  item_id uuid NOT NULL,
  project_id uuid,
  quantity numeric(18, 4) NOT NULL CHECK (quantity > 0),
  received numeric(18, 4) CHECK (received IS NULL OR (received >= 0 AND received <= quantity)),
  loss_reason varchar(500) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, transfer_id) REFERENCES stock_transfers (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES stock_items (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  -- Less arriving than was sent says why.
  CHECK (received IS NULL OR received = quantity OR length(btrim(loss_reason)) > 0)
);
--> statement-breakpoint
CREATE INDEX stock_transfer_lines_transfer_idx ON stock_transfer_lines (workspace_id, transfer_id);
--> statement-breakpoint
CREATE TABLE stock_movements (
  id uuid PRIMARY KEY,
  -- The order movements happened in, also within one command.
  seq bigint GENERATED ALWAYS AS IDENTITY,
  workspace_id uuid NOT NULL,
  -- One command's movements share a batch; replaying the command finds it.
  batch_id uuid NOT NULL,
  item_id uuid NOT NULL,
  location_id uuid NOT NULL,
  -- Whose stock it is: a project's, or free stock when empty.
  project_id uuid,
  kind varchar(16) NOT NULL CHECK (kind IN ('receive', 'issue', 'return', 'transfer_out', 'transfer_in', 'allocate', 'release', 'adjust')),
  quantity numeric(18, 4) NOT NULL CHECK (quantity <> 0),
  -- The project a movement is booked to: issues are for a project even from free stock.
  for_project_id uuid,
  unit_cost numeric(18, 4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  currency char(3),
  receipt_line_id uuid,
  transfer_id uuid,
  reason varchar(500) NOT NULL DEFAULT '',
  moved_on date NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES stock_items (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, for_project_id) REFERENCES delivery_projects (workspace_id, id),
  FOREIGN KEY (workspace_id, receipt_line_id) REFERENCES goods_receipt_lines (workspace_id, id),
  FOREIGN KEY (workspace_id, transfer_id) REFERENCES stock_transfers (workspace_id, id),
  CHECK ((unit_cost IS NULL) = (currency IS NULL)),
  CHECK (kind <> 'receive' OR (quantity > 0 AND receipt_line_id IS NOT NULL)),
  CHECK (kind <> 'issue' OR (quantity < 0 AND for_project_id IS NOT NULL)),
  CHECK (kind <> 'return' OR (quantity > 0 AND for_project_id IS NOT NULL)),
  CHECK (kind NOT IN ('transfer_out', 'transfer_in') OR transfer_id IS NOT NULL),
  CHECK (kind <> 'adjust' OR length(btrim(reason)) > 0)
);
--> statement-breakpoint
CREATE INDEX stock_movements_item_idx ON stock_movements (workspace_id, item_id, seq);
--> statement-breakpoint
CREATE INDEX stock_movements_batch_idx ON stock_movements (workspace_id, batch_id);
--> statement-breakpoint
CREATE INDEX stock_movements_project_idx ON stock_movements (workspace_id, for_project_id) WHERE for_project_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE stock_balances (
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  location_id uuid NOT NULL,
  project_id uuid,
  on_hand numeric(18, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, item_id) REFERENCES stock_items (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CONSTRAINT stock_balances_not_negative CHECK (on_hand >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_balances_key ON stock_balances (workspace_id, item_id, location_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
-- A movement is never changed or removed; a mistake is corrected by another movement.
CREATE FUNCTION stock_movement_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stock movements cannot be changed.';
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_movements_guard BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION stock_movement_guard();
--> statement-breakpoint
-- The balance follows the ledger in the same transaction; going below zero fails the whole command.
-- (Update first: an insert's check runs on the new row before any conflict, so it can't take stock out.)
CREATE FUNCTION stock_movement_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE stock_balances SET on_hand = on_hand + NEW.quantity, updated_at = now()
   WHERE workspace_id = NEW.workspace_id AND item_id = NEW.item_id AND location_id = NEW.location_id
     AND coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(NEW.project_id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF NOT FOUND THEN
    INSERT INTO stock_balances (workspace_id, item_id, location_id, project_id, on_hand)
    VALUES (NEW.workspace_id, NEW.item_id, NEW.location_id, NEW.project_id, NEW.quantity)
    ON CONFLICT (workspace_id, item_id, location_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET on_hand = stock_balances.on_hand + EXCLUDED.on_hand, updated_at = now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_movements_apply AFTER INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION stock_movement_apply();
--> statement-breakpoint
DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['stock_items', 'stock_transfers', 'stock_transfer_lines', 'stock_movements', 'stock_balances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', name);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, name);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON stock_items, stock_transfers, stock_transfer_lines, stock_balances TO wodana_app;
    GRANT SELECT, INSERT ON stock_movements TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, 'in_app', 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('stock.transfer_sent', 'Stock on its way to {{to}}', '{{actor}} sent move {{transfer}} from {{from}}.', '["transfer", "from", "to", "actor", "note"]'),
  ('stock.transfer_short', 'Move {{transfer}} arrived short', '{{actor}}: {{note}}', '["transfer", "from", "to", "actor", "note"]'),
  ('stock.adjusted', 'Stock corrected at {{to}}', '{{actor}}: {{note}}', '["transfer", "from", "to", "actor", "note"]')
) AS template (code, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
--> statement-breakpoint
INSERT INTO permissions (code, description) VALUES
  ('stock.view', 'See stock by location, movements and moves between locations'),
  ('stock.manage', 'Issue stock to projects, reserve and release it, and move it between locations'),
  ('stock.adjust', 'Count stock and correct it, with the reason')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO role_permissions (workspace_id, role_id, permission_id)
SELECT role.workspace_id, role.id, permission.id
  FROM roles role CROSS JOIN permissions permission
 WHERE role.is_system AND role.code IN ('owner', 'administrator') AND permission.code IN ('stock.view', 'stock.manage', 'stock.adjust')
ON CONFLICT (role_id, permission_id) DO NOTHING;
