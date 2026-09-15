ALTER TABLE crm_sla_policies
  ADD COLUMN calculation_mode varchar(20) NOT NULL DEFAULT 'elapsed',
  ADD COLUMN schedule_version smallint NOT NULL DEFAULT 1,
  ADD CONSTRAINT crm_sla_policy_calculation_mode_check
    CHECK(calculation_mode IN ('elapsed','business')),
  ADD CONSTRAINT crm_sla_policy_schedule_version_check CHECK(schedule_version=1),
  ADD CONSTRAINT crm_sla_policy_schedule_object_check CHECK(jsonb_typeof(schedule)='object');
--> statement-breakpoint
ALTER TABLE crm_sla_instances
  ADD COLUMN event_type varchar(80),
  ADD COLUMN cycle integer,
  ADD COLUMN calculation_mode varchar(20) NOT NULL DEFAULT 'elapsed',
  ADD COLUMN policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN total_paused_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN stop_reason varchar(120),
  ADD COLUMN response_evidence jsonb,
  ADD CONSTRAINT crm_sla_instances_workspace_id_id UNIQUE(workspace_id,id),
  ADD CONSTRAINT crm_sla_instances_calculation_mode_check
    CHECK(calculation_mode IN ('elapsed','business')),
  ADD CONSTRAINT crm_sla_instances_policy_snapshot_check
    CHECK(jsonb_typeof(policy_snapshot)='object'),
  ADD CONSTRAINT crm_sla_instances_paused_minutes_check CHECK(total_paused_minutes>=0),
  ADD CONSTRAINT crm_sla_instances_response_evidence_check
    CHECK(response_evidence IS NULL OR jsonb_typeof(response_evidence)='object');
--> statement-breakpoint
UPDATE crm_sla_instances instance
SET event_type=policy.event_type,
    calculation_mode=policy.calculation_mode,
    policy_snapshot=jsonb_build_object(
      'policyId',policy.id,
      'policyVersion',policy.version,
      'name',policy.name,
      'eventType',policy.event_type,
      'warningAfterMinutes',policy.warning_after_minutes,
      'breachAfterMinutes',policy.breach_after_minutes,
      'calculationMode',policy.calculation_mode,
      'scheduleVersion',policy.schedule_version,
      'schedule',policy.schedule,
      'capturedAt',instance.started_at
    )
FROM crm_sla_policies policy
WHERE policy.workspace_id=instance.workspace_id AND policy.id=instance.policy_id;
WITH numbered AS (
  SELECT id,row_number() OVER(
    PARTITION BY workspace_id,target_type,target_id,event_type
    ORDER BY started_at,id
  ) AS cycle
  FROM crm_sla_instances
)
UPDATE crm_sla_instances instance
SET cycle=numbered.cycle
FROM numbered
WHERE numbered.id=instance.id;
ALTER TABLE crm_sla_instances
  ALTER COLUMN event_type SET NOT NULL,
  ALTER COLUMN event_type SET DEFAULT 'first_response',
  ALTER COLUMN cycle SET NOT NULL,
  ALTER COLUMN cycle SET DEFAULT 1,
  ADD CONSTRAINT crm_sla_instances_cycle_check CHECK(cycle>0);
CREATE UNIQUE INDEX crm_sla_instances_cycle_uidx
  ON crm_sla_instances(workspace_id,target_type,target_id,event_type,cycle);
--> statement-breakpoint
CREATE TABLE crm_sla_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL,
  transition varchar(40) NOT NULL,
  from_status varchar(30),
  to_status varchar(30) NOT NULL,
  reason varchar(1000) NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_sla_history_instance_fk
    FOREIGN KEY(workspace_id,instance_id)
    REFERENCES crm_sla_instances(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT crm_sla_history_transition_check
    CHECK(transition IN ('migrated','started','warning','breached','paused','resumed','stopped','response_recorded')),
  CONSTRAINT crm_sla_history_from_status_check
    CHECK(from_status IS NULL OR from_status IN ('active','warning','breached','paused','stopped')),
  CONSTRAINT crm_sla_history_to_status_check
    CHECK(to_status IN ('active','warning','breached','paused','stopped')),
  CONSTRAINT crm_sla_history_evidence_check CHECK(jsonb_typeof(evidence)='object')
);
CREATE INDEX crm_sla_history_instance_idx
  ON crm_sla_history(workspace_id,instance_id,occurred_at);
INSERT INTO crm_sla_history(
  workspace_id,instance_id,transition,from_status,to_status,reason,evidence,occurred_at
)
SELECT workspace_id,id,'migrated',NULL,status,
       'Imported from the existing SLA instance model',
       jsonb_build_object('policySnapshot',policy_snapshot),created_at
FROM crm_sla_instances;
--> statement-breakpoint
CREATE FUNCTION crm_sla_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'crm_sla_history is append-only' USING ERRCODE='55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER crm_sla_history_append_only
BEFORE UPDATE OR DELETE ON crm_sla_history
FOR EACH ROW EXECUTE FUNCTION crm_sla_history_append_only();
--> statement-breakpoint
ALTER TABLE crm_sla_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sla_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON crm_sla_history
  USING(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid)
  WITH CHECK(workspace_id=NULLIF(current_setting('app.current_workspace_id',true),'')::uuid);
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='wodana_app') THEN
    GRANT SELECT,INSERT ON crm_sla_history TO wodana_app;
  END IF;
END $$;
