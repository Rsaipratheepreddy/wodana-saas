-- Quotation builder. One flat list of lines per quote; each line has an area (a case room, or
-- General when empty) and a work package (the firm's trades). Sections are views, never copies.
-- Money settings are workspace configuration; totals are recomputed from these rows.
-- Lines are edited one by one (version-checked), so the case save now upserts lines instead of
-- deleting and re-inserting them, and a line's materials build-up survives any save.

-- How this workspace prices quotes. Defaults come from the region pack; nothing is hard-coded.
CREATE TABLE workspace_quotation_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id) ON DELETE CASCADE,
  default_view varchar(12) NOT NULL DEFAULT 'area' CHECK (default_view IN ('area', 'trade', 'area_trade')),
  prices_include_tax boolean NOT NULL DEFAULT false,
  rounding varchar(10) NOT NULL DEFAULT 'line' CHECK (rounding IN ('line', 'document')),
  default_markup_percent numeric(9, 4) NOT NULL DEFAULT 0 CHECK (default_markup_percent >= 0 AND default_markup_percent <= 1000),
  margin_floor_percent numeric(9, 4) CHECK (margin_floor_percent IS NULL OR (margin_floor_percent >= 0 AND margin_floor_percent < 100)),
  discount_approval_percent numeric(9, 4) CHECK (discount_approval_percent IS NULL OR (discount_approval_percent >= 0 AND discount_approval_percent <= 100)),
  validity_days integer NOT NULL DEFAULT 30 CHECK (validity_days BETWEEN 1 AND 365),
  internal_review boolean NOT NULL DEFAULT true,
  price_book_id uuid,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace_quotation_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workspace_quotation_settings
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint

-- The firm's work packages (trades): joinery, civil, electrical… Added from the builder or Settings.
CREATE TABLE workspace_work_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  position integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_work_packages_name_uidx ON workspace_work_packages (workspace_id, lower(btrim(name))) WHERE archived_at IS NULL;
--> statement-breakpoint
ALTER TABLE workspace_work_packages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace_work_packages FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workspace_work_packages
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE commercial_quote_lines
  ADD COLUMN area_id uuid,
  ADD COLUMN from_area_id uuid,
  ADD COLUMN work_package_id uuid,
  ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'item'
    CHECK (kind IN ('item', 'service', 'allowance', 'client_supplied', 'relocate', 'dismantle', 'remove_store', 'dispose')),
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN catalog_item_id uuid,
  ADD COLUMN catalog_variant_id uuid,
  ADD COLUMN catalog_snapshot jsonb,
  ADD COLUMN pricing_mode varchar(12) NOT NULL DEFAULT 'rate' CHECK (pricing_mode IN ('rate', 'build_up')),
  ADD COLUMN formula varchar(500),
  ADD COLUMN length numeric(18, 6) CHECK (length IS NULL OR length >= 0),
  ADD COLUMN width numeric(18, 6) CHECK (width IS NULL OR width >= 0),
  ADD COLUMN height numeric(18, 6) CHECK (height IS NULL OR height >= 0),
  ADD COLUMN count numeric(18, 6) CHECK (count IS NULL OR count >= 0),
  ADD COLUMN dimension_unit varchar(8),
  ADD COLUMN markup_percent numeric(9, 4) CHECK (markup_percent IS NULL OR markup_percent >= 0),
  ADD COLUMN discount_kind varchar(8) CHECK (discount_kind IS NULL OR discount_kind IN ('percent', 'amount')),
  ADD COLUMN discount_value numeric(18, 6) CHECK (discount_value IS NULL OR discount_value >= 0),
  ADD COLUMN tax_code varchar(40),
  ADD COLUMN tax_rate numeric(7, 4) CHECK (tax_rate IS NULL OR (tax_rate >= 0 AND tax_rate <= 100)),
  ADD COLUMN option_group varchar(80),
  ADD COLUMN note text NOT NULL DEFAULT '',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN updated_by uuid,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
--> statement-breakpoint
ALTER TABLE commercial_quote_lines ADD CONSTRAINT commercial_quote_lines_workspace_key UNIQUE (workspace_id, case_id, quote_id, id);
--> statement-breakpoint
ALTER TABLE commercial_quote_lines ADD CONSTRAINT commercial_quote_lines_area_fk
  FOREIGN KEY (workspace_id, case_id, area_id) REFERENCES pre_project_rooms (workspace_id, case_id, id) ON DELETE SET NULL (area_id);
--> statement-breakpoint
ALTER TABLE commercial_quote_lines ADD CONSTRAINT commercial_quote_lines_from_area_fk
  FOREIGN KEY (workspace_id, case_id, from_area_id) REFERENCES pre_project_rooms (workspace_id, case_id, id) ON DELETE SET NULL (from_area_id);
--> statement-breakpoint
ALTER TABLE commercial_quote_lines ADD CONSTRAINT commercial_quote_lines_work_package_fk
  FOREIGN KEY (workspace_id, work_package_id) REFERENCES workspace_work_packages (workspace_id, id) ON DELETE SET NULL (work_package_id);
--> statement-breakpoint
CREATE INDEX commercial_quote_lines_catalog_idx ON commercial_quote_lines (workspace_id, catalog_item_id) WHERE catalog_item_id IS NOT NULL;
--> statement-breakpoint

-- A line's materials build-up: what one unit of the line is made of. With pricing_mode 'build_up'
-- the line's rate and cost are the sum of these rows.
CREATE TABLE commercial_quote_line_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  line_id text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  kind varchar(12) NOT NULL DEFAULT 'material' CHECK (kind IN ('material', 'finish', 'hardware', 'labour', 'other')),
  catalog_item_id uuid,
  name varchar(200) NOT NULL CHECK (length(btrim(name)) > 0),
  quantity_formula varchar(500),
  quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit varchar(16) NOT NULL DEFAULT '',
  unit_cost numeric(18, 6) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  rate numeric(18, 6) CHECK (rate IS NULL OR rate >= 0),
  waste_percent numeric(7, 4) CHECK (waste_percent IS NULL OR (waste_percent >= 0 AND waste_percent <= 100)),
  supplied_by_client boolean NOT NULL DEFAULT false,
  FOREIGN KEY (workspace_id, case_id, quote_id, line_id) REFERENCES commercial_quote_lines (workspace_id, case_id, quote_id, id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
CREATE INDEX commercial_quote_line_components_line_idx ON commercial_quote_line_components (workspace_id, case_id, quote_id, line_id, position);
--> statement-breakpoint
ALTER TABLE commercial_quote_line_components ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commercial_quote_line_components FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON commercial_quote_line_components
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint

-- Discounts on the whole quote, an area (target 'general' for lines without one) or a trade.
CREATE TABLE commercial_quote_discounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  case_id uuid NOT NULL,
  quote_id text NOT NULL,
  scope varchar(8) NOT NULL CHECK (scope IN ('quote', 'area', 'trade')),
  target_key varchar(64) NOT NULL DEFAULT '',
  kind varchar(8) NOT NULL CHECK (kind IN ('percent', 'amount')),
  value numeric(18, 6) NOT NULL CHECK (value >= 0),
  reason text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, case_id, quote_id, scope, target_key),
  CHECK (kind <> 'percent' OR value <= 100),
  CHECK ((scope = 'quote') = (target_key = '')),
  FOREIGN KEY (workspace_id, case_id, quote_id) REFERENCES commercial_quotes (workspace_id, case_id, id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
--> statement-breakpoint
ALTER TABLE commercial_quote_discounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commercial_quote_discounts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON commercial_quote_discounts
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint

-- The Quote JSON now carries each line's builder fields, its build-up and the quote's discounts,
-- so every existing reader (issue, portal, release) prices exactly what the builder shows.
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

-- The case save keeps lines by id (upsert) so the builder's rows and build-ups are never dropped.
-- Builder-only keys are written to columns, never into detail; components and discounts are
-- owned by the builder and ignored here.
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
    'discountKind','discountValue','taxCode','lineTaxRate','optionGroup','components'];
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
    tax_code, tax_rate, option_group, version)
  SELECT p_workspace_id, p_case_id, quote->>'id', line->>'id', (line_ordinal - 1)::int, coalesce(line->>'room', ''),
    line->>'title', coalesce((line->>'quantity')::numeric, 0), coalesce(line->>'unit', ''),
    coalesce((line->>'unitCost')::numeric, 0), coalesce((line->>'rate')::numeric, 0),
    (line->>'optional')::boolean, line->>'scopeId', line - line_keys,
    coalesce(line->>'kind', 'item'), coalesce(line->>'description', ''), coalesce(line->>'pricingMode', 'rate'),
    coalesce(line->>'note', ''), (line->>'areaId')::uuid, (line->>'fromAreaId')::uuid, (line->>'workPackageId')::uuid,
    (line->>'catalogItemId')::uuid, (line->>'catalogVariantId')::uuid, line->'catalogSnapshot', line->>'formula',
    (line->>'length')::numeric, (line->>'width')::numeric, (line->>'height')::numeric, (line->>'count')::numeric,
    line->>'dimensionUnit', (line->>'markupPercent')::numeric, line->>'discountKind', (line->>'discountValue')::numeric,
    line->>'taxCode', (line->>'lineTaxRate')::numeric, line->>'optionGroup', coalesce((line->>'version')::int, 1)
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
    option_group = excluded.option_group, version = excluded.version
  WHERE commercial_quote_lines.workspace_id = p_workspace_id;

  PERFORM commercial_money_save(p_workspace_id, p_case_id, p_content);
END;
$$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON workspace_quotation_settings, workspace_work_packages,
      commercial_quote_line_components, commercial_quote_discounts TO wodana_app;
  END IF;
END $$;
--> statement-breakpoint

-- Quotation notifications.
INSERT INTO notification_templates (workspace_id, code, channel, locale, version_number, status, subject_template, body_template, variables, approved_at)
SELECT workspace.id, template.code, template.channel, 'en', 1, 'approved', template.subject, template.body, template.variables::jsonb, now()
FROM workspaces workspace CROSS JOIN (VALUES
  ('quotation.mentioned', 'in_app', '{{actor}} mentioned you · {{title}}', '{{note}}', '["title", "actor", "note"]'),
  ('quotation.review_requested', 'in_app', 'Review quote {{title}} · {{clientName}}', '{{actor}} sent it for review.', '["title", "clientName", "actor", "note"]'),
  ('quotation.review_requested', 'email', 'Please review quote {{title}} ({{clientName}})', E'{{actor}} sent quote {{title}} for {{clientName}} for your review.', '["title", "clientName", "actor", "note"]'),
  ('quotation.returned', 'in_app', 'Changes needed: {{title}}', '{{actor}}: {{note}}', '["title", "clientName", "actor", "note"]'),
  ('quotation.client_accepted', 'in_app', '{{clientName}} accepted {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]'),
  ('quotation.client_accepted', 'email', '{{clientName}} accepted {{title}}', E'{{clientName}} accepted {{title}}.\n\n{{note}}', '["title", "clientName", "actor", "note"]'),
  ('quotation.client_changes', 'in_app', '{{clientName}} wants changes to {{title}}', '{{note}}', '["title", "clientName", "actor", "note"]')
) AS template (code, channel, subject, body, variables)
ON CONFLICT (workspace_id, code, channel, locale, version_number) DO NOTHING;
