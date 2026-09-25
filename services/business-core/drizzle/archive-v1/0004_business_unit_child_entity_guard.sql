CREATE OR REPLACE FUNCTION enforce_business_unit_parent_entity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_entity_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
     AND EXISTS (
       SELECT 1 FROM business_units child
       WHERE child.parent_business_unit_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'A business unit with children cannot change legal entity'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.parent_business_unit_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_business_unit_id = NEW.id THEN
    RAISE EXCEPTION 'A business unit cannot be its own parent' USING ERRCODE = '23514';
  END IF;

  SELECT legal_entity_id INTO parent_entity_id
  FROM business_units
  WHERE id = NEW.parent_business_unit_id;

  IF parent_entity_id IS NULL OR parent_entity_id <> NEW.legal_entity_id THEN
    RAISE EXCEPTION 'Parent business unit must use the same legal entity'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND EXISTS (
    WITH RECURSIVE descendants AS (
      SELECT id FROM business_units WHERE parent_business_unit_id = NEW.id
      UNION ALL
      SELECT child.id
      FROM business_units child
      JOIN descendants parent ON child.parent_business_unit_id = parent.id
    )
    SELECT 1 FROM descendants WHERE id = NEW.parent_business_unit_id
  ) THEN
    RAISE EXCEPTION 'Business unit hierarchy cannot contain a cycle'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
