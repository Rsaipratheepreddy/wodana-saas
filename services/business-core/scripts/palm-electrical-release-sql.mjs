// Reviewed client-supplied materials only. Pipe to psql with ON_ERROR_STOP.
// Defaults to a rollback rehearsal; --commit adds missing records, never overwrites.
import { palmLivingCatalogImport } from './palm-living-fixture.mjs';
const catalogId = '4a1fe7ea-f2eb-5a83-9e0a-e41a4556ce96';
const { records } = palmLivingCatalogImport(catalogId);
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const payload = literal(JSON.stringify(records));
process.stdout.write(`\\set ON_ERROR_STOP on
BEGIN;
DO $seed$
DECLARE
  w uuid := 'af041cf6-6bd5-4db1-932a-b145bda49d0c';
  actor uuid;
  row jsonb;
  link jsonb;
  added integer := 0;
  changed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id=w AND slug='plm') THEN RAISE EXCEPTION 'Palm deployment target changed'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('palm-electrical-release'));
  SELECT user_id INTO actor FROM workspace_memberships WHERE workspace_id=w AND status='active' ORDER BY joined_at LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'Active Palm operator missing'; END IF;
  PERFORM set_config('app.current_workspace_id',w::text,true);
  INSERT INTO workspace_catalog_records(workspace_id,id,kind,code,name,content,created_by,updated_by)
  VALUES(w,'${catalogId}','catalog_group','PALM_ELECTRICAL','Palm Living electrical materials',
    '{"description":"Client-supplied electrical materials. Prices and quantities await review.","market":"AE","aliases":[],"attributes":[],"sizes":[],"sources":[],"links":[],"specificationStatus":"needs_specification","dimension":"none"}',actor,actor)
  ON CONFLICT(workspace_id,id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM workspace_catalog_records WHERE workspace_id=w AND id='${catalogId}' AND kind='catalog_group' AND code='PALM_ELECTRICAL') THEN RAISE EXCEPTION 'Catalog identity collision'; END IF;
  FOR row IN SELECT value FROM jsonb_array_elements(${payload}::jsonb) LOOP
    IF EXISTS (SELECT 1 FROM workspace_catalog_records WHERE workspace_id=w AND id=(row->>'id')::uuid AND (catalog_id<>'${catalogId}'::uuid OR kind<>row->>'kind' OR code<>row->>'code')) THEN RAISE EXCEPTION 'Material identity collision'; END IF;
    INSERT INTO workspace_catalog_records(workspace_id,id,kind,code,name,content,catalog_id,created_by,updated_by)
    VALUES(w,(row->>'id')::uuid,row->>'kind',row->>'code',row->>'name',row-ARRAY['id','kind','code','name','version','catalogId'],'${catalogId}',actor,actor)
    ON CONFLICT(workspace_id,id) DO NOTHING;
    GET DIAGNOSTICS changed=ROW_COUNT;
    added := added+changed;
  END LOOP;
  FOR row IN SELECT value FROM jsonb_array_elements(${payload}::jsonb) LOOP
    FOR link IN SELECT value FROM jsonb_array_elements(row->'links') LOOP
      INSERT INTO workspace_catalog_links(workspace_id,record_id,relation,target_id)
      VALUES(w,(row->>'id')::uuid,link->>'relation',(link->>'targetId')::uuid) ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'Palm electrical records added: %, source hardware: 39, units: 2. Existing data preserved.',added;
END $seed$;
${process.argv.includes('--commit') ? 'COMMIT' : 'ROLLBACK'};
`);
