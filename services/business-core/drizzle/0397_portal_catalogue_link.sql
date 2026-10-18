-- The firm's online catalogue (its shop), linked from the client portal; blank when it has none.
ALTER TABLE client_portal_settings ADD COLUMN IF NOT EXISTS catalogue_url varchar(500) NOT NULL DEFAULT ''
  CHECK (catalogue_url = '' OR catalogue_url LIKE 'https://%');
