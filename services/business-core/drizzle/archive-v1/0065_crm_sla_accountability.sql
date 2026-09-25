ALTER TABLE crm_sla_instances
  ADD COLUMN owner_membership_id uuid REFERENCES workspace_memberships(id) ON DELETE SET NULL,
  ADD COLUMN queue_id uuid REFERENCES crm_queues(id) ON DELETE SET NULL,
  ADD COLUMN response_elapsed_minutes integer,
  ADD CONSTRAINT crm_sla_instances_response_elapsed_minutes_check
    CHECK(response_elapsed_minutes IS NULL OR response_elapsed_minutes>=0);

UPDATE crm_sla_instances instance
SET owner_membership_id=lead.owner_membership_id,
    queue_id=lead.queue_id
FROM crm_leads lead
WHERE lead.workspace_id=instance.workspace_id AND lead.id=instance.lead_id;

CREATE TRIGGER crm_sla_instances_owner_membership_id_workspace_guard
BEFORE INSERT OR UPDATE ON crm_sla_instances
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('workspace_memberships','owner_membership_id');

CREATE TRIGGER crm_sla_instances_queue_id_workspace_guard
BEFORE INSERT OR UPDATE ON crm_sla_instances
FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference('crm_queues','queue_id');

CREATE INDEX crm_sla_instances_accountability_idx
  ON crm_sla_instances(workspace_id,owner_membership_id,queue_id,started_at);
--> statement-breakpoint
ALTER TABLE crm_sla_history DROP CONSTRAINT crm_sla_history_transition_check;
ALTER TABLE crm_sla_history
  ADD CONSTRAINT crm_sla_history_transition_check
  CHECK(transition IN ('migrated','started','warning','breached','paused','resumed','stopped','response_recorded','ownership_changed'));
