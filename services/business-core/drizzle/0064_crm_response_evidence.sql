ALTER TABLE crm_sla_instances
  ADD COLUMN responded_at timestamptz,
  ADD COLUMN response_source_type varchar(30),
  ADD COLUMN response_source_id uuid,
  ADD COLUMN response_actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT crm_sla_instances_response_source_type_check
    CHECK(response_source_type IS NULL OR response_source_type IN ('message','activity','lead_status')),
  ADD CONSTRAINT crm_sla_instances_response_fields_check CHECK(
    (responded_at IS NULL AND response_source_type IS NULL AND response_source_id IS NULL AND response_actor_user_id IS NULL)
    OR
    (responded_at IS NOT NULL AND response_source_type IS NOT NULL AND response_source_id IS NOT NULL)
  );
CREATE INDEX crm_sla_instances_response_reporting_idx
  ON crm_sla_instances(workspace_id,event_type,responded_at)
  WHERE responded_at IS NOT NULL;
--> statement-breakpoint
ALTER TABLE crm_activities
  ADD COLUMN interaction_direction varchar(20),
  ADD CONSTRAINT crm_activities_interaction_direction_check
    CHECK(interaction_direction IS NULL OR interaction_direction IN ('inbound','outbound','internal'));
CREATE INDEX crm_activities_response_evidence_idx
  ON crm_activities(workspace_id,lead_id,interaction_direction,completed_at)
  WHERE status='completed';
--> statement-breakpoint
ALTER TABLE crm_messages ADD COLUMN authorship varchar(20);
UPDATE crm_messages
SET authorship=CASE
  WHEN sender_type='user' AND sender_id IS NOT NULL THEN 'human'
  WHEN sender_type='provider' THEN 'provider'
  ELSE 'automation'
END;
ALTER TABLE crm_messages
  ALTER COLUMN authorship SET NOT NULL,
  ALTER COLUMN authorship SET DEFAULT 'automation',
  ADD CONSTRAINT crm_messages_authorship_check
    CHECK(authorship IN ('human','automation','provider')),
  ADD CONSTRAINT crm_messages_human_author_check
    CHECK(authorship<>'human' OR (sender_type='user' AND sender_id IS NOT NULL));
CREATE INDEX crm_messages_response_evidence_idx
  ON crm_messages(workspace_id,conversation_id,direction,authorship,sent_at)
  WHERE direction='outbound';
