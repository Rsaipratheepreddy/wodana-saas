WITH inserted_taxonomies AS (
  INSERT INTO crm_taxonomies (workspace_id, code, name)
  SELECT workspace.id, 'lead_channel_third_party', 'Third-party lead channels'
  FROM workspaces workspace
  ON CONFLICT (workspace_id, code) DO NOTHING
  RETURNING id, workspace_id
)
INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position)
SELECT workspace_id, id, 'plyleads', 'PlyLeads', 0
FROM inserted_taxonomies;
--> statement-breakpoint
WITH inserted_taxonomies AS (
  INSERT INTO crm_taxonomies (workspace_id, code, name)
  SELECT workspace.id, 'lead_channel_digital_marketing', 'Digital-marketing lead channels'
  FROM workspaces workspace
  ON CONFLICT (workspace_id, code) DO NOTHING
  RETURNING id, workspace_id
)
INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position)
SELECT workspace_id, id, 'palm_living', 'Palm Living', 0
FROM inserted_taxonomies;
