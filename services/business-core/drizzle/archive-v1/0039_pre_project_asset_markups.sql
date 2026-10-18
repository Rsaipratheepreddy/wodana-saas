CREATE TABLE pre_project_asset_markups (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, asset_id uuid PRIMARY KEY,
 source_asset_id uuid NOT NULL, strokes jsonb NOT NULL, input_hash varchar(64) NOT NULL,
 CONSTRAINT asset_markup_generated_fk FOREIGN KEY(workspace_id,case_id,asset_id) REFERENCES pre_project_brief_assets(workspace_id,case_id,id),
 CONSTRAINT asset_markup_source_fk FOREIGN KEY(workspace_id,case_id,source_asset_id) REFERENCES pre_project_brief_assets(workspace_id,case_id,id),
 CONSTRAINT asset_markup_distinct CHECK(asset_id<>source_asset_id),
 CONSTRAINT asset_markup_strokes CHECK(jsonb_typeof(strokes)='array' AND jsonb_array_length(strokes) BETWEEN 1 AND 100)
);
ALTER TABLE pre_project_asset_markups ENABLE ROW LEVEL SECURITY;
ALTER TABLE pre_project_asset_markups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pre_project_asset_markups USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid) WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN GRANT SELECT,INSERT ON pre_project_asset_markups TO wodana_app; END IF; END $$;
CREATE INDEX asset_markup_source_idx ON pre_project_asset_markups(workspace_id,case_id,source_asset_id);
