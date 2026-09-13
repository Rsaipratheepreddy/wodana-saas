-- The CRM update trigger writes updated_at; the project-link table previously lacked it.
ALTER TABLE crm_project_links ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
