-- Stock value at moving average cost, per item, place and owner, in the workspace's currency. Goods in
-- carry their cost (a delivery's price converted at the day's rate; a move keeps the cost it left with);
-- goods out leave at the average. Corrections worth more than the workspace sets wait for a second person.
ALTER TABLE stock_balances ADD COLUMN value numeric(18, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE workspace_purchasing_settings ADD COLUMN stock_adjust_approval_value numeric(18, 4) CHECK (stock_adjust_approval_value IS NULL OR stock_adjust_approval_value >= 0);
--> statement-breakpoint
-- A movement without a cost takes the average of what it moves: the balance's own, else the item's across places.
CREATE FUNCTION stock_movement_cost() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE average numeric;
BEGIN
  IF NEW.unit_cost IS NULL THEN
    SELECT CASE WHEN on_hand > 0 THEN value / on_hand END INTO average FROM stock_balances
     WHERE workspace_id = NEW.workspace_id AND item_id = NEW.item_id AND location_id = NEW.location_id
       AND coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(NEW.project_id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF average IS NULL THEN
      SELECT CASE WHEN sum(on_hand) > 0 THEN sum(value) / sum(on_hand) END INTO average FROM stock_balances
       WHERE workspace_id = NEW.workspace_id AND item_id = NEW.item_id;
    END IF;
    IF average IS NOT NULL THEN
      NEW.unit_cost := round(average, 4);
      NEW.currency := (SELECT default_currency FROM workspaces WHERE id = NEW.workspace_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER stock_movements_cost BEFORE INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movement_cost();
--> statement-breakpoint
-- The balance follows the ledger: quantity and value. Taking out everything takes out all its value, so
-- rounding never leaves value behind.
CREATE OR REPLACE FUNCTION stock_movement_apply() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE delta numeric;
BEGIN
  delta := round(NEW.quantity * coalesce(NEW.unit_cost, 0), 4);
  UPDATE stock_balances
     SET on_hand = on_hand + NEW.quantity,
         value = CASE WHEN on_hand + NEW.quantity = 0 THEN 0 ELSE greatest(value + delta, 0) END,
         updated_at = now()
   WHERE workspace_id = NEW.workspace_id AND item_id = NEW.item_id AND location_id = NEW.location_id
     AND coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(NEW.project_id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF NOT FOUND THEN
    INSERT INTO stock_balances (workspace_id, item_id, location_id, project_id, on_hand, value)
    VALUES (NEW.workspace_id, NEW.item_id, NEW.location_id, NEW.project_id, NEW.quantity, greatest(delta, 0))
    ON CONFLICT (workspace_id, item_id, location_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid))
    DO UPDATE SET on_hand = stock_balances.on_hand + EXCLUDED.on_hand, value = greatest(stock_balances.value + EXCLUDED.value, 0), updated_at = now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Balances that already exist take the value of the movements that made them.
UPDATE stock_balances balance SET value = greatest(coalesce((
  SELECT sum(round(movement.quantity * coalesce(movement.unit_cost, 0), 4)) FROM stock_movements movement
   WHERE movement.workspace_id = balance.workspace_id AND movement.item_id = balance.item_id AND movement.location_id = balance.location_id
     AND coalesce(movement.project_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(balance.project_id, '00000000-0000-0000-0000-000000000000'::uuid)), 0), 0)
 WHERE balance.on_hand > 0;
--> statement-breakpoint
CREATE TABLE stock_adjustment_requests (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  item_id uuid NOT NULL,
  location_id uuid NOT NULL,
  project_id uuid,
  counted numeric(18, 4) NOT NULL CHECK (counted >= 0),
  difference numeric(18, 4) NOT NULL CHECK (difference <> 0),
  value numeric(18, 4) NOT NULL,
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) > 0),
  status varchar(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by uuid NOT NULL REFERENCES users (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES users (id),
  decided_at timestamptz,
  decision_note varchar(500) NOT NULL DEFAULT '',
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES stock_items (workspace_id, id),
  FOREIGN KEY (workspace_id, location_id) REFERENCES stock_locations (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES delivery_projects (workspace_id, id),
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_by <> requested_by)),
  CHECK (status <> 'rejected' OR length(btrim(decision_note)) > 0)
);
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'ALTER TABLE stock_adjustment_requests ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE stock_adjustment_requests FORCE ROW LEVEL SECURITY';
  EXECUTE $policy$CREATE POLICY tenant_isolation ON stock_adjustment_requests
    USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
    WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON stock_adjustment_requests TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, 'stock.adjustment_needs_approval', 'in_app', 'en', 1, 'approved', 'A stock correction needs your approval', '{{actor}} counted {{note}} at {{to}}.',
       '["transfer", "from", "to", "actor", "note"]'::jsonb, now()
  FROM workspaces workspace
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
