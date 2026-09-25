-- One write path for split documents. The application repositories and every script call these
-- functions, so the split between the remaining JSON document and its relational rows is defined
-- once. They run as the caller (RLS applies). Constraints reject any direct write that would put
-- tasks or quotes back into the documents, so a stale writer fails loudly instead of losing data.
CREATE FUNCTION project_execution_save(p_workspace_id uuid, p_project_id uuid, p_revision integer, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  tasks jsonb := coalesce(p_content->'tasks', '[]'::jsonb);
  typed text[] := ARRAY['id','parentId','packageId','package','title','description','area','location','ownerId',
    'assigneeIds','resourceId','start','end','baselineStart','baselineEnd','predecessors','quantity','unit',
    'weight','approved','status','priority','inspectionRequired','scopeIds','drawingId','readiness','blocker'];
BEGIN
  INSERT INTO project_execution(project_id, workspace_id, revision, content)
  VALUES (p_project_id, p_workspace_id, p_revision, p_content - 'tasks')
  ON CONFLICT (project_id) DO UPDATE SET revision = excluded.revision, content = excluded.content, updated_at = now()
  WHERE project_execution.workspace_id = p_workspace_id;

  DELETE FROM project_tasks task WHERE task.workspace_id = p_workspace_id AND task.project_id = p_project_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(tasks) item WHERE item->>'id' = task.id);

  INSERT INTO project_tasks(
    workspace_id, project_id, id, sort_order, parent_id, package_id, package, title, description, area, location,
    owner_id, assignee_ids, resource_id, start_date, end_date, baseline_start, baseline_end, quantity, unit, weight,
    approved, status, priority, inspection_required, scope_ids, drawing_id, ready_scope, ready_access, ready_materials,
    blocker, production_detail)
  SELECT p_workspace_id, p_project_id, task->>'id', (ordinal - 1)::int, nullif(task->>'parentId', ''), task->>'packageId',
    coalesce(task->>'package', ''), task->>'title', coalesce(task->>'description', ''), coalesce(task->>'area', ''),
    task->>'location', coalesce(task->>'ownerId', ''),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(task->'assigneeIds', '[]'::jsonb))), '{}'),
    coalesce(task->>'resourceId', ''),
    nullif(task->>'start', '')::date, nullif(task->>'end', '')::date,
    nullif(task->>'baselineStart', '')::date, nullif(task->>'baselineEnd', '')::date,
    coalesce((task->>'quantity')::numeric, 0), coalesce(task->>'unit', ''),
    coalesce((task->>'weight')::numeric, 0), coalesce((task->>'approved')::numeric, 0),
    task->>'status', task->>'priority', coalesce((task->>'inspectionRequired')::boolean, false),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(task->'scopeIds', '[]'::jsonb))), '{}'),
    coalesce(task->>'drawingId', ''),
    coalesce((task->'readiness'->>'scope')::boolean, false),
    coalesce((task->'readiness'->>'access')::boolean, false),
    coalesce((task->'readiness'->>'materials')::boolean, false),
    coalesce(task->>'blocker', ''),
    nullif(task - typed, '{}'::jsonb)
  FROM jsonb_array_elements(tasks) WITH ORDINALITY AS item(task, ordinal)
  ON CONFLICT (project_id, id) DO UPDATE SET
    sort_order = excluded.sort_order, parent_id = excluded.parent_id, package_id = excluded.package_id,
    package = excluded.package, title = excluded.title, description = excluded.description, area = excluded.area,
    location = excluded.location, owner_id = excluded.owner_id, assignee_ids = excluded.assignee_ids,
    resource_id = excluded.resource_id, start_date = excluded.start_date, end_date = excluded.end_date,
    baseline_start = excluded.baseline_start, baseline_end = excluded.baseline_end, quantity = excluded.quantity,
    unit = excluded.unit, weight = excluded.weight, approved = excluded.approved, status = excluded.status,
    priority = excluded.priority, inspection_required = excluded.inspection_required, scope_ids = excluded.scope_ids,
    drawing_id = excluded.drawing_id, ready_scope = excluded.ready_scope, ready_access = excluded.ready_access,
    ready_materials = excluded.ready_materials, blocker = excluded.blocker, production_detail = excluded.production_detail
  WHERE project_tasks.workspace_id = p_workspace_id;

  DELETE FROM project_task_dependencies WHERE workspace_id = p_workspace_id AND project_id = p_project_id;
  INSERT INTO project_task_dependencies(workspace_id, project_id, task_id, predecessor_id, sort_order)
  SELECT DISTINCT ON (item.task->>'id', predecessor.value) p_workspace_id, p_project_id, item.task->>'id',
    predecessor.value, (predecessor.ordinal - 1)::int
  FROM jsonb_array_elements(tasks) AS item(task)
  CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(item.task->'predecessors', '[]'::jsonb)) WITH ORDINALITY AS predecessor(value, ordinal)
  ORDER BY item.task->>'id', predecessor.value, predecessor.ordinal;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION commercial_case_save(p_workspace_id uuid, p_case_id uuid, p_revision integer, p_content jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  quotes jsonb := coalesce(p_content->'quotes', '[]'::jsonb);
  quote_keys text[] := ARRAY['id','number','kind','round','familyId','direction','baselineId','status','title',
    'currency','validUntil','discount','taxRate','total','hash','lines'];
  line_keys text[] := ARRAY['id','room','title','quantity','unit','unitCost','rate','optional','scopeId'];
BEGIN
  INSERT INTO commercial_cases(workspace_id, case_id, revision, content)
  VALUES (p_workspace_id, p_case_id, p_revision, p_content - 'quotes')
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

  DELETE FROM commercial_quote_lines WHERE workspace_id = p_workspace_id AND case_id = p_case_id;
  INSERT INTO commercial_quote_lines(
    workspace_id, case_id, quote_id, id, sort_order, room, title, quantity, unit, unit_cost, rate, optional, scope_id, detail)
  SELECT p_workspace_id, p_case_id, quote->>'id', line->>'id', (line_ordinal - 1)::int, coalesce(line->>'room', ''),
    line->>'title', coalesce((line->>'quantity')::numeric, 0), coalesce(line->>'unit', ''),
    coalesce((line->>'unitCost')::numeric, 0), coalesce((line->>'rate')::numeric, 0),
    (line->>'optional')::boolean, line->>'scopeId', line - line_keys
  FROM jsonb_array_elements(quotes) AS item(quote)
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(quote->'lines', '[]'::jsonb)) WITH ORDINALITY AS entry(line, line_ordinal);
END;
$$;
--> statement-breakpoint
ALTER TABLE project_execution ADD CONSTRAINT project_execution_tasks_are_rows CHECK (NOT content ? 'tasks');
--> statement-breakpoint
ALTER TABLE commercial_cases ADD CONSTRAINT commercial_cases_quotes_are_rows CHECK (NOT content ? 'quotes');
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION project_execution_save(uuid, uuid, integer, jsonb) TO wodana_app;
    GRANT EXECUTE ON FUNCTION commercial_case_save(uuid, uuid, integer, jsonb) TO wodana_app;
  END IF;
END $$;
