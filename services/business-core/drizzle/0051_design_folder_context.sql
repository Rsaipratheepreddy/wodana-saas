ALTER TABLE pre_project_design_folders ADD COLUMN scope_entry_id uuid;
ALTER TABLE pre_project_design_folders ADD CONSTRAINT pre_project_design_folder_scope_entry_fk
  FOREIGN KEY(workspace_id,case_id,scope_entry_id)
  REFERENCES pre_project_brief_entries(workspace_id,case_id,id);
CREATE INDEX pre_project_design_folders_context_idx
  ON pre_project_design_folders(workspace_id,case_id,room_id,scope_entry_id);
