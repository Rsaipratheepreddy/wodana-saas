-- Keep requirement documents on their existing scope records so measurements,
-- designs and quotation references retain their original IDs.
ALTER TABLE pre_project_brief_entries ADD COLUMN note_document jsonb;
ALTER TABLE pre_project_brief_entries ADD COLUMN pinned boolean NOT NULL DEFAULT false;
