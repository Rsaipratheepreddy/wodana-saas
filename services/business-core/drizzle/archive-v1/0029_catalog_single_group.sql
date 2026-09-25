-- Group membership is organisational: one primary group per master record.
-- Typed links to rooms, materials and other records remain independent.
CREATE UNIQUE INDEX workspace_catalog_single_group_idx
  ON workspace_catalog_links(workspace_id,record_id)
  WHERE relation='record_group';
