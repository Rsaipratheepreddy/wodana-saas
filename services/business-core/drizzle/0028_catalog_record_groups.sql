ALTER TABLE workspace_catalog_records DROP CONSTRAINT workspace_catalog_records_kind_check;
--> statement-breakpoint
ALTER TABLE workspace_catalog_records ADD CONSTRAINT workspace_catalog_records_kind_check CHECK (kind IN ('room','work','category','material','finish','brand','unit','service','sku','hardware','consumable','execution','factory_process','site_process','resource','measurement','construction','variant_rule','execution_rule','wastage_rule','logistics_rule','installation_rule','commercial_rule','tax','rate_zone','rate_card','catalog_group','record_group','custom','variant'));
--> statement-breakpoint
ALTER TABLE workspace_catalog_links DROP CONSTRAINT workspace_catalog_links_relation_check;
--> statement-breakpoint
ALTER TABLE workspace_catalog_links ADD CONSTRAINT workspace_catalog_links_relation_check CHECK (relation IN ('room','work','category','material','finish','brand','unit','service','sku','hardware','consumable','execution','factory_process','site_process','resource','measurement','construction','variant_rule','execution_rule','wastage_rule','logistics_rule','installation_rule','commercial_rule','tax','rate_zone','rate_card','catalog_group','record_group','custom','variant','parent','related'));
