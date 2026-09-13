WITH inserted_taxonomies AS (
  INSERT INTO crm_taxonomies (workspace_id, code, name)
  SELECT workspace.id, 'budget_range', 'Budget ranges'
  FROM workspaces workspace
  ON CONFLICT (workspace_id, code) DO NOTHING
  RETURNING id, workspace_id
), legacy_options(code, label, position) AS (
  VALUES
    ('under_50000', 'Under AED 50,000', 0),
    ('50000_100000', 'AED 50,000–100,000', 1),
    ('100000_250000', 'AED 100,000–250,000', 2),
    ('250000_500000', 'AED 250,000–500,000', 3),
    ('500000_1000000', 'AED 500,000–1,000,000', 4),
    ('1000000_plus', 'AED 1,000,000+', 5),
    ('not_sure', 'Not sure yet', 6)
)
INSERT INTO crm_taxonomy_options (workspace_id, taxonomy_id, code, label, position)
SELECT taxonomy.workspace_id, taxonomy.id, option.code, option.label, option.position
FROM inserted_taxonomies taxonomy
CROSS JOIN legacy_options option;
