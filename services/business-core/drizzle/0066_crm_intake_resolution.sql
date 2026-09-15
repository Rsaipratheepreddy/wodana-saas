ALTER TABLE crm_intake_events
  ADD COLUMN payload_hash_version smallint NOT NULL DEFAULT 1,
  ADD COLUMN resolution_type varchar(40),
  ADD COLUMN resolved_party_id uuid REFERENCES crm_parties(id) ON DELETE RESTRICT,
  ADD COLUMN resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolution_evidence jsonb;

UPDATE crm_intake_events intake
SET resolution_type='legacy_ready',
    resolved_party_id=enquiry.party_id,
    resolved_at=COALESCE(intake.processed_at,intake.updated_at),
    resolution_evidence=jsonb_build_object('migrated',true,'enquiryId',enquiry.id)
FROM crm_enquiries enquiry
WHERE intake.workspace_id=enquiry.workspace_id
  AND intake.id=enquiry.intake_event_id
  AND intake.status='ready';

ALTER TABLE crm_intake_events
  ALTER COLUMN payload_hash_version SET DEFAULT 2,
  ADD CONSTRAINT crm_intake_events_payload_hash_version_check
    CHECK(payload_hash_version IN (1,2)),
  ADD CONSTRAINT crm_intake_events_resolution_type_check
    CHECK(resolution_type IS NULL OR resolution_type IN (
      'legacy_ready','verified_contact','new_identity','review_attach','review_create_new'
    )),
  ADD CONSTRAINT crm_intake_events_resolution_evidence_check
    CHECK(resolution_evidence IS NULL OR jsonb_typeof(resolution_evidence)='object'),
  ADD CONSTRAINT crm_intake_events_resolution_fields_check CHECK(
    (resolution_type IS NULL AND resolved_party_id IS NULL AND resolved_at IS NULL AND resolution_evidence IS NULL)
    OR
    (resolution_type IS NOT NULL AND resolved_party_id IS NOT NULL AND resolved_at IS NOT NULL AND resolution_evidence IS NOT NULL)
  ),
  ADD CONSTRAINT crm_intake_events_ready_resolution_check CHECK(
    status<>'ready' OR (resolution_type IS NOT NULL AND resolved_party_id IS NOT NULL AND resolved_at IS NOT NULL)
  );

CREATE TRIGGER crm_intake_events_resolved_party_id_workspace_guard
BEFORE INSERT OR UPDATE ON crm_intake_events
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('crm_parties','resolved_party_id');

CREATE INDEX crm_intake_events_resolution_idx
  ON crm_intake_events(workspace_id,resolved_party_id,resolved_at)
  WHERE resolved_party_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE crm_identity_candidates
  ADD COLUMN decision varchar(30),
  ADD COLUMN resolved_party_id uuid REFERENCES crm_parties(id) ON DELETE RESTRICT;

UPDATE crm_identity_candidates candidate
SET decision=CASE
      WHEN candidate.status='accepted' THEN 'attach'
      WHEN candidate.status='rejected' AND intake.status='ready' THEN 'resolved_elsewhere'
      WHEN candidate.status='rejected' THEN 'reject'
      ELSE NULL
    END,
    resolved_party_id=CASE
      WHEN candidate.status='accepted' THEN candidate.candidate_party_id
      WHEN candidate.status='rejected' AND intake.status='ready' THEN intake.resolved_party_id
      ELSE NULL
    END,
    reviewed_at=CASE
      WHEN candidate.status<>'pending' THEN COALESCE(candidate.reviewed_at,candidate.updated_at)
      ELSE candidate.reviewed_at
    END
FROM crm_intake_events intake
WHERE intake.workspace_id=candidate.workspace_id AND intake.id=candidate.intake_event_id;

ALTER TABLE crm_identity_candidates
  ADD CONSTRAINT crm_identity_candidates_strength_check
    CHECK(strength IN ('exact','fuzzy')),
  ADD CONSTRAINT crm_identity_candidates_status_check
    CHECK(status IN ('pending','accepted','rejected')),
  ADD CONSTRAINT crm_identity_candidates_reasons_check
    CHECK(jsonb_typeof(reasons)='array'),
  ADD CONSTRAINT crm_identity_candidates_decision_check
    CHECK(decision IS NULL OR decision IN ('attach','create_new','reject','resolved_elsewhere')),
  ADD CONSTRAINT crm_identity_candidates_review_state_check CHECK(
    (status='pending' AND decision IS NULL AND reviewed_at IS NULL AND resolved_party_id IS NULL)
    OR
    (status='accepted' AND decision='attach' AND reviewed_at IS NOT NULL AND resolved_party_id IS NOT NULL)
    OR
    (status='rejected' AND decision='reject' AND reviewed_at IS NOT NULL AND resolved_party_id IS NULL)
    OR
    (status='rejected' AND decision IN ('create_new','resolved_elsewhere') AND reviewed_at IS NOT NULL AND resolved_party_id IS NOT NULL)
  );

CREATE TRIGGER crm_identity_candidates_resolved_party_id_workspace_guard
BEFORE INSERT OR UPDATE ON crm_identity_candidates
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('crm_parties','resolved_party_id');

CREATE INDEX crm_identity_candidates_resolved_party_idx
  ON crm_identity_candidates(workspace_id,resolved_party_id,reviewed_at)
  WHERE resolved_party_id IS NOT NULL;
