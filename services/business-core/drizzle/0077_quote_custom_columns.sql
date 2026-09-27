-- The firm's own quote columns ("Brand", "Finish", "Lead time"…): defined once for the workspace, with
-- a value per line. Values are rows, not JSON; the quote JSON and the case save carry them so revisions
-- and older flows keep them.
CREATE TABLE quotation_columns (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name varchar(60) NOT NULL CHECK (btrim(name) <> ''),
  kind varchar(8) NOT NULL CHECK (kind IN ('text', 'number')),
  position integer NOT NULL DEFAULT 0,
  show_in_proposal boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX quotation_columns_name ON quotation_columns (workspace_id, lower(name)) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE TABLE commercial_quote_line_values (
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  line_id text NOT NULL,
  column_id uuid NOT NULL,
  value varchar(1000) NOT NULL CHECK (value <> ''),
  PRIMARY KEY (case_id, quote_id, line_id, column_id),
  FOREIGN KEY (case_id, quote_id, line_id) REFERENCES commercial_quote_lines (case_id, quote_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, column_id) REFERENCES quotation_columns (workspace_id, id)
);
--> statement-breakpoint
CREATE INDEX commercial_quote_line_values_column ON commercial_quote_line_values (workspace_id, column_id);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotation_columns', 'commercial_quote_line_values'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($policy$CREATE POLICY tenant_isolation ON %I
      USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
      WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)$policy$, t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON quotation_columns TO wodana_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON commercial_quote_line_values TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commercial_quote_json(quote commercial_quotes)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT quote.detail
    || jsonb_build_object(
      'id', quote.id,
      'number', quote.number,
      'kind', quote.kind,
      'status', quote.status,
      'title', quote.title,
      'currency', quote.currency,
      'validUntil', coalesce(quote.valid_until::text, ''),
      'discount', quote.discount,
      'taxRate', quote.tax_rate,
      'total', quote.total,
      'lines', coalesce((
        SELECT jsonb_agg(
          line.detail || jsonb_build_object(
            'id', line.id, 'room', line.room, 'title', line.title, 'quantity', line.quantity,
            'unit', line.unit, 'unitCost', line.unit_cost, 'rate', line.rate
          ) || jsonb_strip_nulls(jsonb_build_object(
            'optional', line.optional, 'scopeId', line.scope_id,
            'kind', NULLIF(line.kind, 'item'), 'description', NULLIF(line.description, ''),
            'pricingMode', NULLIF(line.pricing_mode, 'rate'), 'note', NULLIF(line.note, ''), 'version', NULLIF(line.version, 1),
            'areaId', line.area_id, 'fromAreaId', line.from_area_id, 'workPackageId', line.work_package_id,
            'catalogItemId', line.catalog_item_id, 'catalogVariantId', line.catalog_variant_id, 'catalogSnapshot', line.catalog_snapshot,
            'formula', line.formula, 'length', line.length, 'width', line.width, 'height', line.height, 'count', line.count,
            'dimensionUnit', line.dimension_unit, 'markupPercent', line.markup_percent,
            'discountKind', line.discount_kind, 'discountValue', line.discount_value,
            'taxCode', line.tax_code, 'lineTaxRate', line.tax_rate, 'optionGroup', line.option_group,
            'imageAssetId', line.image_asset_id, 'catalogImageId', line.catalog_image_id,
            'changeOp', line.change_op, 'boqLineId', line.boq_line_id, 'material', line.material,
            'values', (
              SELECT jsonb_object_agg(cell.column_id::text, cell.value)
              FROM commercial_quote_line_values cell
              WHERE cell.case_id = line.case_id AND cell.quote_id = line.quote_id AND cell.line_id = line.id),
            'components', (
              SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                'id', component.id, 'kind', component.kind, 'catalogItemId', component.catalog_item_id, 'name', component.name,
                'quantityFormula', component.quantity_formula, 'quantity', component.quantity, 'unit', component.unit,
                'unitCost', component.unit_cost, 'rate', component.rate, 'wastePercent', component.waste_percent,
                'suppliedByClient', component.supplied_by_client)) ORDER BY component.position)
              FROM commercial_quote_line_components component
              WHERE component.case_id = line.case_id AND component.quote_id = line.quote_id AND component.line_id = line.id)
          ))
          ORDER BY line.sort_order)
        FROM commercial_quote_lines line
        WHERE line.case_id = quote.case_id AND line.quote_id = quote.id
      ), '[]'::jsonb)
    )
    || jsonb_strip_nulls(jsonb_build_object(
      'discounts', (
        SELECT jsonb_agg(jsonb_build_object('scope', discount.scope, 'target', discount.target_key, 'kind', discount.kind,
          'value', discount.value, 'reason', discount.reason) ORDER BY discount.scope, discount.target_key)
        FROM commercial_quote_discounts discount
        WHERE discount.case_id = quote.case_id AND discount.quote_id = quote.id),
      'round', quote.round, 'familyId', quote.family_id, 'direction', quote.direction,
      'baselineId', quote.baseline_id, 'hash', quote.hash
    ));
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION commercial_case_save(p_workspace_id uuid, p_case_id uuid, p_revision integer, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  quotes jsonb := coalesce(p_content->'quotes', '[]'::jsonb);
  quote_keys text[] := ARRAY['id','number','kind','round','familyId','direction','baselineId','status','title',
    'currency','validUntil','discount','taxRate','total','hash','lines','discounts'];
  line_keys text[] := ARRAY['id','room','title','quantity','unit','unitCost','rate','optional','scopeId',
    'kind','description','pricingMode','note','version','areaId','fromAreaId','workPackageId','catalogItemId',
    'catalogVariantId','catalogSnapshot','formula','length','width','height','count','dimensionUnit','markupPercent',
    'discountKind','discountValue','taxCode','lineTaxRate','optionGroup','components','imageAssetId','catalogImageId','changeOp','boqLineId','material','values'];
BEGIN
  INSERT INTO commercial_cases(workspace_id, case_id, revision, content)
  VALUES (p_workspace_id, p_case_id, p_revision, p_content - ARRAY['quotes','payments','receipts','allocations','dealFile'])
  ON CONFLICT (case_id) DO UPDATE SET revision = excluded.revision, content = excluded.content, updated_at = now()
  WHERE commercial_cases.workspace_id = p_workspace_id;

  DELETE FROM commercial_quotes quote WHERE quote.workspace_id = p_workspace_id AND quote.case_id = p_case_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(quotes) item WHERE item->>'id' = quote.id);

  INSERT INTO commercial_quotes(
    workspace_id, case_id, id, sort_order, number, kind, round, family_id, direction, baseline_id, status, title,
    currency, valid_until, discount, tax_rate, total, hash, detail)
  SELECT p_workspace_id, p_case_id, quote->>'id', (ordinal - 1)::int, (quote->>'number')::int, quote->>'kind',
    quote->>'round', quote->>'familyId', quote->>'direction', quote->>'baselineId', quote->>'status', quote->>'title',
    quote->>'currency', nullif(quote->>'validUntil', '')::date,
    coalesce((quote->>'discount')::numeric, 0), coalesce((quote->>'taxRate')::numeric, 0),
    coalesce((quote->>'total')::numeric, 0), quote->>'hash', quote - quote_keys
  FROM jsonb_array_elements(quotes) WITH ORDINALITY AS item(quote, ordinal)
  ON CONFLICT (case_id, id) DO UPDATE SET
    sort_order = excluded.sort_order, number = excluded.number, kind = excluded.kind, round = excluded.round,
    family_id = excluded.family_id, direction = excluded.direction, baseline_id = excluded.baseline_id,
    status = excluded.status, title = excluded.title, currency = excluded.currency, valid_until = excluded.valid_until,
    discount = excluded.discount, tax_rate = excluded.tax_rate, total = excluded.total, hash = excluded.hash,
    detail = excluded.detail
  WHERE commercial_quotes.workspace_id = p_workspace_id;

  DELETE FROM commercial_quote_lines line WHERE line.workspace_id = p_workspace_id AND line.case_id = p_case_id
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(quotes) AS item(quote)
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(quote->'lines', '[]'::jsonb)) AS entry(entry_line)
      WHERE quote->>'id' = line.quote_id AND entry_line->>'id' = line.id);

  INSERT INTO commercial_quote_lines(
    workspace_id, case_id, quote_id, id, sort_order, room, title, quantity, unit, unit_cost, rate, optional, scope_id, detail,
    kind, description, pricing_mode, note, area_id, from_area_id, work_package_id, catalog_item_id, catalog_variant_id,
    catalog_snapshot, formula, length, width, height, count, dimension_unit, markup_percent, discount_kind, discount_value,
    tax_code, tax_rate, option_group, version, image_asset_id, catalog_image_id, change_op, boq_line_id, material)
  SELECT p_workspace_id, p_case_id, quote->>'id', line->>'id', (line_ordinal - 1)::int, coalesce(line->>'room', ''),
    line->>'title', coalesce((line->>'quantity')::numeric, 0), coalesce(line->>'unit', ''),
    CASE WHEN line ? 'unitCost' AND line->'unitCost' = 'null'::jsonb THEN NULL ELSE coalesce((line->>'unitCost')::numeric, 0) END, coalesce((line->>'rate')::numeric, 0),
    (line->>'optional')::boolean, line->>'scopeId', line - line_keys,
    coalesce(line->>'kind', 'item'), coalesce(line->>'description', ''), coalesce(line->>'pricingMode', 'rate'),
    coalesce(line->>'note', ''), (line->>'areaId')::uuid, (line->>'fromAreaId')::uuid, (line->>'workPackageId')::uuid,
    (line->>'catalogItemId')::uuid, (line->>'catalogVariantId')::uuid, line->'catalogSnapshot', line->>'formula',
    (line->>'length')::numeric, (line->>'width')::numeric, (line->>'height')::numeric, (line->>'count')::numeric,
    line->>'dimensionUnit', (line->>'markupPercent')::numeric, line->>'discountKind', (line->>'discountValue')::numeric,
    line->>'taxCode', (line->>'lineTaxRate')::numeric, line->>'optionGroup', coalesce((line->>'version')::int, 1),
    (line->>'imageAssetId')::uuid, (line->>'catalogImageId')::uuid, line->>'changeOp', (line->>'boqLineId')::uuid,
    line->>'material'
  FROM jsonb_array_elements(quotes) AS item(quote)
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(quote->'lines', '[]'::jsonb)) WITH ORDINALITY AS entry(line, line_ordinal)
  ON CONFLICT (case_id, quote_id, id) DO UPDATE SET
    sort_order = excluded.sort_order, room = excluded.room, title = excluded.title, quantity = excluded.quantity,
    unit = excluded.unit, unit_cost = excluded.unit_cost, rate = excluded.rate, optional = excluded.optional,
    scope_id = excluded.scope_id, detail = excluded.detail, kind = excluded.kind, description = excluded.description,
    pricing_mode = excluded.pricing_mode, note = excluded.note, area_id = excluded.area_id, from_area_id = excluded.from_area_id,
    work_package_id = excluded.work_package_id, catalog_item_id = excluded.catalog_item_id,
    catalog_variant_id = excluded.catalog_variant_id, catalog_snapshot = excluded.catalog_snapshot, formula = excluded.formula,
    length = excluded.length, width = excluded.width, height = excluded.height, count = excluded.count,
    dimension_unit = excluded.dimension_unit, markup_percent = excluded.markup_percent, discount_kind = excluded.discount_kind,
    discount_value = excluded.discount_value, tax_code = excluded.tax_code, tax_rate = excluded.tax_rate,
    option_group = excluded.option_group, version = excluded.version,
    image_asset_id = excluded.image_asset_id, catalog_image_id = excluded.catalog_image_id,
    change_op = excluded.change_op, boq_line_id = excluded.boq_line_id, material = excluded.material
  WHERE commercial_quote_lines.workspace_id = p_workspace_id;

  -- Each line's values in the firm's own columns travel with it (revisions and older flows keep them).
  DELETE FROM commercial_quote_line_values cell WHERE cell.workspace_id = p_workspace_id AND cell.case_id = p_case_id;
  INSERT INTO commercial_quote_line_values (workspace_id, case_id, quote_id, line_id, column_id, value)
  SELECT p_workspace_id, p_case_id, quote->>'id', line->>'id', col.id, left(entry.value #>> '{}', 1000)
  FROM jsonb_array_elements(quotes) AS item(quote)
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(quote->'lines', '[]'::jsonb)) AS entry_line(line)
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(line->'values') = 'object' THEN line->'values' ELSE '{}'::jsonb END) AS entry
  JOIN quotation_columns col ON col.workspace_id = p_workspace_id AND col.id::text = entry.key
  WHERE coalesce(entry.value #>> '{}', '') <> '';

  PERFORM commercial_money_save(p_workspace_id, p_case_id, p_content);
END;
$$;
