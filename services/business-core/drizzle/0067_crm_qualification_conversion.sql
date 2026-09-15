ALTER TABLE crm_leads
  ADD COLUMN qualification_evidence jsonb,
  ADD COLUMN qualification_evidence_hash varchar(64),
  ADD COLUMN qualified_by uuid REFERENCES users(id) ON DELETE SET NULL;

WITH evidence AS (
  SELECT lead.id,
    jsonb_build_object(
      'version',1,
      'legacy',true,
      'leadId',lead.id,
      'serviceType',enquiry.service_type,
      'selection','none',
      'form',NULL,
      'answers',COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'questionKey',value.question_key,
          'value',value.value,
          'capturedAt',value.captured_at
        ) ORDER BY value.question_key)
        FROM crm_lead_qualification_values value
        WHERE value.workspace_id=lead.workspace_id AND value.lead_id=lead.id
      ),'[]'::jsonb),
      'requiredKeys','[]'::jsonb,
      'evaluatedAt',COALESCE(lead.qualified_at,lead.updated_at)
    ) AS payload
  FROM crm_leads lead
  JOIN crm_enquiries enquiry ON enquiry.workspace_id=lead.workspace_id AND enquiry.id=lead.enquiry_id
  WHERE lead.status='qualified'
)
UPDATE crm_leads lead
SET qualified_at=COALESCE(lead.qualified_at,lead.updated_at),
    qualification_evidence=evidence.payload,
    qualification_evidence_hash=encode(digest(evidence.payload::text,'sha256'),'hex')
FROM evidence
WHERE lead.id=evidence.id;

ALTER TABLE crm_leads
  ADD CONSTRAINT crm_leads_qualification_evidence_check
    CHECK(qualification_evidence IS NULL OR jsonb_typeof(qualification_evidence)='object'),
  ADD CONSTRAINT crm_leads_qualification_hash_check
    CHECK(qualification_evidence_hash IS NULL OR qualification_evidence_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT crm_leads_qualification_state_check CHECK(
    (status='qualified' AND qualified_at IS NOT NULL
      AND qualification_evidence IS NOT NULL AND qualification_evidence_hash IS NOT NULL)
    OR
    (status<>'qualified' AND qualified_at IS NULL
      AND qualification_evidence IS NULL AND qualification_evidence_hash IS NULL AND qualified_by IS NULL)
  );

ALTER TABLE crm_qualification_forms
  ADD CONSTRAINT crm_qualification_forms_status_check
    CHECK(status IN ('draft','active','archived'));

ALTER TABLE crm_qualification_questions
  ADD CONSTRAINT crm_qualification_questions_data_type_check
    CHECK(data_type IN ('text','number','boolean','date','select','multi_select')),
  ADD CONSTRAINT crm_qualification_questions_scoring_check
    CHECK(jsonb_typeof(scoring)='object'),
  ADD CONSTRAINT crm_qualification_questions_configuration_check
    CHECK(jsonb_typeof(configuration)='object');

CREATE UNIQUE INDEX crm_qualification_forms_active_scope_uidx
  ON crm_qualification_forms(workspace_id,COALESCE(service_type,''))
  WHERE status='active';
--> statement-breakpoint
ALTER TABLE crm_opportunities
  ADD COLUMN conversion_origin varchar(30),
  ADD COLUMN conversion_request_hash varchar(64),
  ADD COLUMN qualification_evidence jsonb,
  ADD COLUMN qualification_evidence_hash varchar(64),
  ADD COLUMN converted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN converted_at timestamptz;

WITH evidence AS (
  SELECT opportunity.id,
    COALESCE(lead.qualification_evidence,jsonb_build_object(
      'version',1,
      'legacy',true,
      'leadId',opportunity.lead_id,
      'selection','none',
      'form',NULL,
      'answers','[]'::jsonb,
      'requiredKeys','[]'::jsonb,
      'evaluatedAt',opportunity.created_at
    )) AS payload,
    lead.qualification_evidence_hash
  FROM crm_opportunities opportunity
  LEFT JOIN crm_leads lead ON lead.workspace_id=opportunity.workspace_id AND lead.id=opportunity.lead_id
  WHERE opportunity.lead_id IS NOT NULL
)
UPDATE crm_opportunities opportunity
SET conversion_origin='legacy',
    conversion_request_hash=encode(digest('legacy:'||opportunity.id::text,'sha256'),'hex'),
    qualification_evidence=evidence.payload,
    qualification_evidence_hash=COALESCE(
      evidence.qualification_evidence_hash,
      encode(digest(evidence.payload::text,'sha256'),'hex')
    ),
    converted_at=opportunity.created_at
FROM evidence
WHERE opportunity.id=evidence.id;

ALTER TABLE crm_opportunities
  ADD CONSTRAINT crm_opportunities_conversion_origin_check
    CHECK(conversion_origin IS NULL OR conversion_origin IN ('legacy','lead_qualification','pre_project_start')),
  ADD CONSTRAINT crm_opportunities_conversion_request_hash_check
    CHECK(conversion_request_hash IS NULL OR conversion_request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT crm_opportunities_qualification_evidence_check
    CHECK(qualification_evidence IS NULL OR jsonb_typeof(qualification_evidence)='object'),
  ADD CONSTRAINT crm_opportunities_qualification_hash_check
    CHECK(qualification_evidence_hash IS NULL OR qualification_evidence_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT crm_opportunities_lead_conversion_check CHECK(
    lead_id IS NULL OR (
      conversion_origin IS NOT NULL AND conversion_request_hash IS NOT NULL
      AND qualification_evidence IS NOT NULL AND qualification_evidence_hash IS NOT NULL
      AND converted_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX crm_opportunities_lead_uidx
  ON crm_opportunities(workspace_id,lead_id)
  WHERE lead_id IS NOT NULL;
