-- Design inspections at the factory (PLM-150): the go-live reset clears the inspection rounds and their photos with the
-- work orders they belong to (business records, not configuration). Idempotent.
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('factory_inspections', 'clear', NULL, '{}'),
  ('factory_inspection_photos', 'clear', NULL, ARRAY['object_key', 'preview_key'])
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
