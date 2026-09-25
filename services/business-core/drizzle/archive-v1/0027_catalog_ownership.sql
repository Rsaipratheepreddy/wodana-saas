ALTER TABLE workspace_catalog_records ADD COLUMN catalog_id uuid;
--> statement-breakpoint
INSERT INTO workspace_catalog_records (workspace_id,id,kind,code,name,content,created_by,updated_by)
SELECT DISTINCT ON (workspace_id) workspace_id,gen_random_uuid(),'catalog_group','DEFAULT_CATALOG','My catalog',
'{"description":"Workspace catalog","market":"CUSTOM","aliases":[],"attributes":[],"sizes":[],"sources":[],"links":[],"specificationStatus":"needs_specification","dimension":"none","configuration":{}}'::jsonb,created_by,updated_by
FROM workspace_catalog_records WHERE kind <> 'catalog_group'
ON CONFLICT (workspace_id,kind,code) DO NOTHING;
--> statement-breakpoint
UPDATE workspace_catalog_records r SET catalog_id=c.id FROM workspace_catalog_records c
WHERE r.workspace_id=c.workspace_id AND c.kind='catalog_group' AND c.code='DEFAULT_CATALOG' AND r.kind<>'catalog_group';
--> statement-breakpoint
ALTER TABLE workspace_catalog_records ADD CONSTRAINT workspace_catalog_owner_fk FOREIGN KEY(workspace_id,catalog_id) REFERENCES workspace_catalog_records(workspace_id,id);
--> statement-breakpoint
DROP INDEX workspace_catalog_name_idx;
--> statement-breakpoint
ALTER TABLE workspace_catalog_records DROP CONSTRAINT IF EXISTS workspace_catalog_records_workspace_id_kind_code_key;
--> statement-breakpoint
DROP INDEX IF EXISTS workspace_catalog_records_workspace_id_kind_code_key;
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_catalog_record_code_idx ON workspace_catalog_records(workspace_id,catalog_id,kind,code) WHERE catalog_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_catalog_name_idx ON workspace_catalog_records(workspace_id,catalog_id,kind,lower(name)) WHERE catalog_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_catalog_container_name_idx ON workspace_catalog_records(workspace_id,lower(name)) WHERE kind='catalog_group';
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_catalog_container_code_idx ON workspace_catalog_records(workspace_id,code) WHERE kind='catalog_group';
--> statement-breakpoint
ALTER TABLE workspace_catalog_records ADD CONSTRAINT workspace_catalog_owner_check CHECK ((kind='catalog_group' AND catalog_id IS NULL) OR (kind<>'catalog_group' AND catalog_id IS NOT NULL));
