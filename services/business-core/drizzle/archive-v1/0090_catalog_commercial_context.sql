ALTER TABLE legal_entities
  ADD CONSTRAINT legal_entities_workspace_identity_uq UNIQUE(workspace_id,id);

ALTER TABLE workspace_supplier_offers
  ADD COLUMN legal_entity_id uuid,
  ADD COLUMN replaces_offer_id uuid,
  ADD CONSTRAINT workspace_supplier_offers_legal_entity_fk
    FOREIGN KEY(workspace_id,legal_entity_id)
    REFERENCES legal_entities(workspace_id,id) NOT VALID,
  ADD CONSTRAINT workspace_supplier_offers_replacement_fk
    FOREIGN KEY(workspace_id,replaces_offer_id)
    REFERENCES workspace_supplier_offers(workspace_id,id) NOT VALID,
  ADD CONSTRAINT workspace_supplier_offers_replacement_check
    CHECK(replaces_offer_id IS NULL OR replaces_offer_id<>id);

CREATE INDEX workspace_supplier_offers_entity_idx
  ON workspace_supplier_offers(workspace_id,legal_entity_id,status,effective_from);
CREATE INDEX workspace_supplier_offers_replacement_idx
  ON workspace_supplier_offers(workspace_id,replaces_offer_id)
  WHERE replaces_offer_id IS NOT NULL;

ALTER TABLE workspace_supplier_offers
  VALIDATE CONSTRAINT workspace_supplier_offers_legal_entity_fk;
ALTER TABLE workspace_supplier_offers
  VALIDATE CONSTRAINT workspace_supplier_offers_replacement_fk;

-- Existing active offers are retained for migration safety. New and changed rows must
-- declare the legal entity whose base currency forms the accounting boundary.
ALTER TABLE workspace_supplier_offers
  DROP CONSTRAINT workspace_supplier_offers_active_check,
  ADD CONSTRAINT workspace_supplier_offers_active_check CHECK(
    status<>'active' OR (
      legal_entity_id IS NOT NULL
      AND unit_record_id IS NOT NULL
      AND amount IS NOT NULL
      AND currency IS NOT NULL
      AND effective_from IS NOT NULL
      AND source_type IS NOT NULL
      AND source_reference IS NOT NULL
      AND length(btrim(source_reference))>0
      AND tax_treatment<>'unconfirmed'
    )
  ) NOT VALID;
