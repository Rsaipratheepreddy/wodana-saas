CREATE TABLE crm_opportunity_counters (
 workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 last_value bigint NOT NULL DEFAULT 0 CHECK (last_value >= 0)
);
ALTER TABLE crm_opportunities ADD COLUMN reference varchar(40);
-- Existing deals retain their identity while receiving a stable workspace-scoped reference.
ALTER TABLE crm_opportunities DISABLE TRIGGER set_updated_at;
WITH numbered AS (
 SELECT id, row_number() OVER (PARTITION BY workspace_id ORDER BY created_at, id) AS n
 FROM crm_opportunities
)
UPDATE crm_opportunities opportunity
SET reference = 'D-' || lpad(numbered.n::text, greatest(4, length(numbered.n::text)), '0')
FROM numbered WHERE opportunity.id = numbered.id;
ALTER TABLE crm_opportunities ENABLE TRIGGER set_updated_at;
INSERT INTO crm_opportunity_counters (workspace_id, last_value)
SELECT workspace_id, count(*) FROM crm_opportunities GROUP BY workspace_id;
ALTER TABLE crm_opportunities ALTER COLUMN reference SET NOT NULL;
CREATE UNIQUE INDEX crm_opportunities_reference_uidx ON crm_opportunities(workspace_id, reference);

ALTER TABLE crm_opportunity_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_opportunity_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_opportunity_counters
 USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
 WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);

CREATE FUNCTION crm_allocate_opportunity_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocated bigint;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
   RAISE EXCEPTION 'Deal reference and workspace cannot be changed';
  END IF;
 ELSE
  INSERT INTO crm_opportunity_counters (workspace_id, last_value) VALUES (NEW.workspace_id, 1)
  ON CONFLICT (workspace_id) DO UPDATE SET last_value = crm_opportunity_counters.last_value + 1
  RETURNING last_value INTO allocated;
  NEW.reference := 'D-' || lpad(allocated::text, greatest(4, length(allocated::text)), '0');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crm_opportunity_reference BEFORE INSERT OR UPDATE ON crm_opportunities
 FOR EACH ROW EXECUTE FUNCTION crm_allocate_opportunity_reference();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
  GRANT SELECT,INSERT,UPDATE ON crm_opportunity_counters TO wodana_app;
 END IF;
END $$;
