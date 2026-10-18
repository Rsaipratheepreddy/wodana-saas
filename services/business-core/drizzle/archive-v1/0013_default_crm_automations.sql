CREATE TEMPORARY TABLE crm_default_automation_templates (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  run_once_per_aggregate boolean NOT NULL,
  definition jsonb NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO crm_default_automation_templates (code,name,description,run_once_per_aggregate,definition) VALUES
  ('new_enquiry_assignment','New enquiry assignment','Assign a new enquiry and create its first response task.',true,
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.enquiry.ready.v1"]}},{"key":"assign","type":"assign","configuration":{}},{"key":"first_response","type":"create_task","configuration":{"title":"Respond to new enquiry","priority":"high","delayMinutes":0,"isNextAction":true}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"assign"},{"from":"assign","to":"first_response"},{"from":"first_response","to":"finish"}]}'::jsonb),
  ('customer_reply_follow_up','Customer reply follow-up','Create an owned action when a customer reply needs attention.',false,
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.customer.replied.v1"]}},{"key":"reply_task","type":"create_task","configuration":{"title":"Respond to customer","priority":"high","delayMinutes":0,"isNextAction":true}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"reply_task"},{"from":"reply_task","to":"finish"}]}'::jsonb),
  ('sla_breach_escalation','SLA breach escalation','Create an urgent escalation task when a lead SLA is breached.',false,
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.sla.breached.v1"]}},{"key":"escalate","type":"create_task","configuration":{"title":"Resolve breached lead SLA","priority":"urgent","delayMinutes":0,"isNextAction":true}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"escalate"},{"from":"escalate","to":"finish"}]}'::jsonb),
  ('appointment_reminder','Appointment reminder','Wait, then send an approved appointment reminder template.',false,
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.appointment.changed.v1"]}},{"key":"wait","type":"delay_until","configuration":{"delayMinutes":60}},{"key":"remind","type":"send_template","configuration":{"channel":"email","templateCode":"crm.appointment_reminder","eventType":"crm.appointment.reminder"}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"wait"},{"from":"wait","to":"remind"},{"from":"remind","to":"finish"}]}'::jsonb),
  ('opportunity_won_handoff','Won opportunity handoff','Request human approval before emitting a Projects handoff.',true,
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.opportunity.won.v1"]}},{"key":"approve","type":"request_approval","configuration":{"title":"Approve project handoff"}},{"key":"handoff","type":"create_project_handoff","configuration":{"mode":"delivery"}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"approve"},{"from":"approve","to":"handoff"},{"from":"handoff","to":"finish"}]}'::jsonb),
  ('consent_withdrawal_stop_outreach','Consent withdrawal protection','Stop active outreach sequences when communication consent changes.',false,
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.consent.changed.v1"]}},{"key":"stop_outreach","type":"stop_sequence","configuration":{"reason":"consent_changed"}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"stop_outreach"},{"from":"stop_outreach","to":"finish"}]}'::jsonb);
--> statement-breakpoint
INSERT INTO automation_definitions
  (workspace_id,code,name,description,status,run_once_per_aggregate)
SELECT workspace.id,template.code,template.name,template.description,'draft',template.run_once_per_aggregate
FROM workspaces workspace
CROSS JOIN crm_default_automation_templates template
ON CONFLICT (workspace_id,code) DO NOTHING;
--> statement-breakpoint
INSERT INTO automation_versions
  (workspace_id,definition_id,version_number,definition,checksum)
SELECT definition.workspace_id,definition.id,1,template.definition,md5(template.definition::text)
FROM automation_definitions definition
JOIN crm_default_automation_templates template ON template.code=definition.code
WHERE NOT EXISTS (
  SELECT 1 FROM automation_versions version
  WHERE version.workspace_id=definition.workspace_id
    AND version.definition_id=definition.id
    AND version.version_number=1
);
