-- Structured production recipes on catalogue products (PLM-162, PLM-166).
--
-- 1. catalog_components: each component line says what kind of thing it is (board, fabric, foam, hardware, labour or
--    other), whether its formula gives the quantity per unit made or per batch (with the batch size), and for labour
--    lines the hours. Lines from before this change read as "other" per unit; a line whose component is a service or is
--    counted in a unit of time is labour (the same rule item readiness already uses).
-- 2. catalog_items: the recipe's verification (who and when). Quantities for a project come only from a verified recipe;
--    saving the components again clears it, so a changed recipe is checked again before it is used.
-- No new tables. Idempotent; never disables RLS.
ALTER TABLE catalog_components
  ADD COLUMN IF NOT EXISTS component_type varchar(10) NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS quantity_basis varchar(10) NOT NULL DEFAULT 'per_unit',
  ADD COLUMN IF NOT EXISTS batch_size numeric(18, 4),
  ADD COLUMN IF NOT EXISTS labour_hours numeric(18, 4);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_components_component_type_check') THEN
    ALTER TABLE catalog_components ADD CONSTRAINT catalog_components_component_type_check
      CHECK (component_type IN ('board', 'fabric', 'foam', 'hardware', 'labour', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_components_quantity_basis_check') THEN
    ALTER TABLE catalog_components ADD CONSTRAINT catalog_components_quantity_basis_check
      CHECK (quantity_basis IN ('per_unit', 'per_batch') AND (quantity_basis = 'per_unit' OR (batch_size IS NOT NULL AND batch_size > 0)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_components_labour_hours_check') THEN
    ALTER TABLE catalog_components ADD CONSTRAINT catalog_components_labour_hours_check CHECK (labour_hours IS NULL OR labour_hours >= 0);
  END IF;
END $$;
--> statement-breakpoint
-- Existing lines: a service, or a component counted in hours or days, is labour (as item readiness already reads them).
UPDATE catalog_components component SET component_type = 'labour'
  FROM catalog_items part
 WHERE part.workspace_id = component.workspace_id AND part.id = component.component_item_id
   AND component.component_type = 'other' AND (part.item_type = 'service' OR component.unit_code IN ('hr', 'min', 'day', 'week', 'month'));
--> statement-breakpoint
ALTER TABLE catalog_items
  ADD COLUMN IF NOT EXISTS recipe_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS recipe_verified_by uuid REFERENCES users (id);
