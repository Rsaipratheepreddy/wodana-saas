-- A legal entity's base currency and country are fixed once it has financial records (a
-- commercial case bound to it, a payment request or a receipt). Every write path is covered;
-- the application checks first to return a clear message.
CREATE FUNCTION legal_entity_has_financial_records(p_workspace_id uuid, p_entity_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM commercial_payments WHERE workspace_id = p_workspace_id AND legal_entity_id = p_entity_id::text)
      OR EXISTS (SELECT 1 FROM commercial_receipts WHERE workspace_id = p_workspace_id AND legal_entity_id = p_entity_id::text)
      OR EXISTS (SELECT 1 FROM commercial_cases WHERE workspace_id = p_workspace_id
                   AND content->'financeContext'->>'legalEntityId' = p_entity_id::text);
$$;
--> statement-breakpoint
CREATE FUNCTION guard_legal_entity_money_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.base_currency IS DISTINCT FROM OLD.base_currency OR NEW.country_code IS DISTINCT FROM OLD.country_code)
     AND legal_entity_has_financial_records(OLD.workspace_id, OLD.id) THEN
    RAISE EXCEPTION 'legal entity % has financial records; its currency and country are fixed', OLD.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'legal_entity_money_identity_fixed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER legal_entity_money_identity_fixed BEFORE UPDATE ON legal_entities
  FOR EACH ROW EXECUTE FUNCTION guard_legal_entity_money_identity();
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION legal_entity_has_financial_records(uuid, uuid) TO wodana_app;
  END IF;
END $$;
