ALTER TABLE crm_sla_instances
  ADD COLUMN paused_from_status varchar(30),
  ADD COLUMN remaining_warning_minutes integer,
  ADD COLUMN remaining_breach_minutes integer,
  ADD CONSTRAINT crm_sla_instances_paused_from_status_check
    CHECK(paused_from_status IS NULL OR paused_from_status IN ('active','warning')),
  ADD CONSTRAINT crm_sla_instances_remaining_warning_check
    CHECK(remaining_warning_minutes IS NULL OR remaining_warning_minutes>=0),
  ADD CONSTRAINT crm_sla_instances_remaining_breach_check
    CHECK(remaining_breach_minutes IS NULL OR remaining_breach_minutes>=0),
  ADD CONSTRAINT crm_sla_instances_pause_state_check CHECK(
    (status='paused' AND paused_at IS NOT NULL AND paused_from_status IS NOT NULL
      AND remaining_warning_minutes IS NOT NULL AND remaining_breach_minutes IS NOT NULL)
    OR
    (status<>'paused' AND paused_at IS NULL AND paused_from_status IS NULL
      AND remaining_warning_minutes IS NULL AND remaining_breach_minutes IS NULL)
  );
--> statement-breakpoint
WITH ranked AS (
  SELECT id,row_number() OVER(
    PARTITION BY workspace_id,event_type
    ORDER BY created_at,id
  ) AS position
  FROM crm_sla_policies
  WHERE status='active'
)
UPDATE crm_sla_policies policy
SET status='archived',version=version+1,updated_at=now()
FROM ranked
WHERE ranked.id=policy.id AND ranked.position>1;
CREATE UNIQUE INDEX crm_sla_policies_active_event_uidx
  ON crm_sla_policies(workspace_id,event_type)
  WHERE status='active';
--> statement-breakpoint
ALTER TABLE crm_activities
  ADD COLUMN sla_instance_id uuid,
  ADD CONSTRAINT crm_activities_sla_instance_fk
    FOREIGN KEY(workspace_id,sla_instance_id)
    REFERENCES crm_sla_instances(workspace_id,id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX crm_activities_sla_instance_uidx
  ON crm_activities(workspace_id,sla_instance_id)
  WHERE sla_instance_id IS NOT NULL;
