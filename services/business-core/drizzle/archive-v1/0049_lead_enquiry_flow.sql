CREATE TABLE crm_enquiry_counters (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);
ALTER TABLE crm_enquiries ADD COLUMN reference varchar(40);
ALTER TABLE crm_enquiries ADD COLUMN details jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE crm_enquiries ADD CONSTRAINT crm_enquiries_details_object CHECK (jsonb_typeof(details) = 'object');
-- Preserve any demo records; numbering is scoped to a workspace and never reuses deleted numbers.
-- Backfilling a reference must not make an existing enquiry look newly updated.
ALTER TABLE crm_enquiries DISABLE TRIGGER set_updated_at;
WITH numbered AS (
 SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY received_at, created_at, id) AS n
 FROM crm_enquiries
)
UPDATE crm_enquiries enquiry SET reference = 'E-' || lpad(numbered.n::text, greatest(4, length(numbered.n::text)), '0')
FROM numbered WHERE enquiry.id = numbered.id;
ALTER TABLE crm_enquiries ENABLE TRIGGER set_updated_at;
INSERT INTO crm_enquiry_counters (workspace_id, last_value)
SELECT workspace_id, count(*) FROM crm_enquiries GROUP BY workspace_id;
ALTER TABLE crm_enquiries ALTER COLUMN reference SET NOT NULL;
CREATE UNIQUE INDEX crm_enquiries_reference_uidx ON crm_enquiries (workspace_id, reference);
CREATE INDEX crm_enquiries_reporting_idx ON crm_enquiries (workspace_id, service_type, received_at);
ALTER TABLE crm_enquiry_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_enquiry_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_enquiry_counters
 USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
 WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
CREATE FUNCTION crm_allocate_enquiry_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocated bigint;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
   RAISE EXCEPTION 'Enquiry reference and workspace cannot be changed';
  END IF;
 ELSE
  INSERT INTO crm_enquiry_counters (workspace_id, last_value) VALUES (NEW.workspace_id, 1)
  ON CONFLICT (workspace_id) DO UPDATE SET last_value = crm_enquiry_counters.last_value + 1
  RETURNING last_value INTO allocated;
  NEW.reference := 'E-' || lpad(allocated::text, greatest(4, length(allocated::text)), '0');
 END IF;
 IF NEW.title IS NULL OR btrim(NEW.title) = '' THEN NEW.title := NEW.reference; END IF;
 RETURN NEW;
END $$;

CREATE TABLE crm_lead_forms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 token varchar(64) NOT NULL UNIQUE,
 draft jsonb NOT NULL,
 published jsonb,
 status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','paused')),
 version integer NOT NULL DEFAULT 1,
 created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_lead_forms_workspace_idx ON crm_lead_forms (workspace_id, updated_at);
ALTER TABLE crm_lead_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_lead_forms FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_lead_forms
 USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
 WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
-- Public access resolves one deliberately published form using its unguessable link.
-- This policy grants no writes; the HTTP response includes only customer-facing questions.
CREATE POLICY published_form_read ON crm_lead_forms FOR SELECT
 USING (status='published' AND published IS NOT NULL
   AND token = NULLIF(current_setting('app.current_lead_form_token', true), ''));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
  GRANT SELECT,INSERT,UPDATE,DELETE ON crm_lead_forms TO wodana_app;
 END IF;
END $$;
CREATE TRIGGER crm_enquiry_reference BEFORE INSERT OR UPDATE ON crm_enquiries
 FOR EACH ROW EXECUTE FUNCTION crm_allocate_enquiry_reference();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
  GRANT SELECT,INSERT,UPDATE ON crm_enquiry_counters TO wodana_app;
 END IF;
END $$;
