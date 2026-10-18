-- Tax and document numbering per legal entity.
-- Tax: one current tax profile per entity; rates are effective-dated rows. A change closes the old
-- row and opens a new one, so issued documents keep the rate they used. The country's tax model
-- comes from the region pack; "not configured" is the absence of a profile, never 0%.
-- Numbering: sequences only move forward, reset yearly when the prefix carries {YYYY}, and are
-- allocated under a row lock so two documents never share a number.
ALTER TABLE tax_profiles ADD COLUMN version integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE UNIQUE INDEX tax_profiles_current_uidx ON tax_profiles (legal_entity_id)
  WHERE status = 'active' AND effective_to IS NULL;
--> statement-breakpoint
CREATE TABLE tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  tax_profile_id uuid NOT NULL REFERENCES tax_profiles (id) ON DELETE CASCADE,
  code varchar(40) NOT NULL,
  label varchar(80) NOT NULL,
  rate numeric(7, 4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  is_default boolean NOT NULL DEFAULT false,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (code ~ '^[a-z0-9_]+$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX tax_rates_current_code_uidx ON tax_rates (tax_profile_id, code) WHERE effective_to IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX tax_rates_current_default_uidx ON tax_rates (tax_profile_id) WHERE effective_to IS NULL AND is_default;
--> statement-breakpoint
CREATE INDEX tax_rates_workspace_idx ON tax_rates (workspace_id);
--> statement-breakpoint
ALTER TABLE tax_rates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tax_rates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tax_rates
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Numbering. Existing yearly sequences gain the year so a reset never repeats a number.
ALTER TABLE document_sequences ADD COLUMN current_period integer;
--> statement-breakpoint
UPDATE document_sequences SET prefix = prefix || '{YYYY}-'
  WHERE reset_policy = 'annual' AND position('{YYYY}' in prefix) = 0;
--> statement-breakpoint
ALTER TABLE document_sequences
  ADD CONSTRAINT document_sequences_reset_policy_check CHECK (reset_policy IN ('never', 'annual')),
  ADD CONSTRAINT document_sequences_annual_has_year CHECK (reset_policy <> 'annual' OR position('{YYYY}' in prefix) > 0),
  ADD CONSTRAINT document_sequences_padding_check CHECK (padding BETWEEN 1 AND 12),
  ADD CONSTRAINT document_sequences_next_number_check CHECK (next_number >= 1);
--> statement-breakpoint
CREATE FUNCTION guard_document_sequence_forward()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Numbers are never reused: within the same period the counter only moves forward.
  IF NEW.next_number < OLD.next_number AND NEW.current_period IS NOT DISTINCT FROM OLD.current_period THEN
    RAISE EXCEPTION 'document numbers only move forward (next is %)', OLD.next_number
      USING ERRCODE = 'check_violation', CONSTRAINT = 'document_sequence_forward_only';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER document_sequence_forward_only BEFORE UPDATE ON document_sequences
  FOR EACH ROW EXECUTE FUNCTION guard_document_sequence_forward();
--> statement-breakpoint
-- Allocates the next number for an entity's document type, in the entity's time zone year.
CREATE FUNCTION allocate_document_number(p_workspace_id uuid, p_entity_id uuid, p_document_type text, p_at timestamptz DEFAULT now())
RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  sequence_row document_sequences%ROWTYPE;
  entity_zone text;
  period integer;
  allocated integer;
BEGIN
  SELECT timezone INTO entity_zone FROM legal_entities WHERE workspace_id = p_workspace_id AND id = p_entity_id;
  IF entity_zone IS NULL THEN RAISE EXCEPTION 'legal entity % not found', p_entity_id USING ERRCODE = 'no_data_found'; END IF;
  SELECT * INTO sequence_row FROM document_sequences
    WHERE workspace_id = p_workspace_id AND legal_entity_id = p_entity_id AND document_type = p_document_type
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no % numbering for legal entity %', p_document_type, p_entity_id USING ERRCODE = 'no_data_found'; END IF;
  period := extract(year FROM p_at AT TIME ZONE entity_zone)::integer;
  allocated := sequence_row.next_number;
  -- Reset only when a recorded year has passed; a sequence set to continue (e.g. from 250) keeps going.
  IF sequence_row.reset_policy = 'annual' AND sequence_row.current_period IS NOT NULL AND sequence_row.current_period <> period THEN
    allocated := 1;
  END IF;
  UPDATE document_sequences SET next_number = allocated + 1, current_period = period, version = version + 1
    WHERE id = sequence_row.id;
  RETURN replace(sequence_row.prefix, '{YYYY}', period::text) || lpad(allocated::text, greatest(sequence_row.padding, length(allocated::text)), '0');
END;
$$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, INSERT, UPDATE ON tax_rates TO wodana_app;
    GRANT EXECUTE ON FUNCTION allocate_document_number(uuid, uuid, text, timestamptz) TO wodana_app;
  END IF;
END $$;
