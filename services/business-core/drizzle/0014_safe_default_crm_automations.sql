CREATE TEMPORARY TABLE crm_safe_default_automation_updates (
  code text PRIMARY KEY,
  description text NOT NULL,
  legacy_definition jsonb NOT NULL,
  definition jsonb NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO crm_safe_default_automation_updates (code,description,legacy_definition,definition) VALUES
  ('appointment_reminder','Send an approved reminder one hour before an appointment.',
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.appointment.changed.v1"]}},{"key":"wait","type":"delay_until","configuration":{"delayMinutes":60}},{"key":"remind","type":"send_template","configuration":{"channel":"email","templateCode":"crm.appointment_reminder","eventType":"crm.appointment.reminder"}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"wait"},{"from":"wait","to":"remind"},{"from":"remind","to":"finish"}]}'::jsonb,
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.appointment.changed.v1"]}},{"key":"wait","type":"delay_until","configuration":{"dueAt":"$event.startsAt","offsetMinutes":-60}},{"key":"remind","type":"send_template","configuration":{"channel":"email","templateCode":"crm.appointment_reminder","eventType":"crm.appointment.reminder"}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"wait"},{"from":"wait","to":"remind"},{"from":"remind","to":"finish"}]}'::jsonb),
  ('consent_withdrawal_stop_outreach','Stop active outreach only when communication consent is no longer granted.',
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.consent.changed.v1"]}},{"key":"stop_outreach","type":"stop_sequence","configuration":{"reason":"consent_changed"}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"stop_outreach"},{"from":"stop_outreach","to":"finish"}]}'::jsonb,
   '{"nodes":[{"key":"start","type":"trigger","configuration":{"eventTypes":["crm.consent.changed.v1"]}},{"key":"not_granted","type":"filter","configuration":{"condition":{"path":"event.status","operator":"not_equals","value":"granted"}}},{"key":"stop_outreach","type":"stop_sequence","configuration":{"reason":"consent_not_granted"}},{"key":"finish","type":"end","configuration":{}}],"edges":[{"from":"start","to":"not_granted"},{"from":"not_granted","to":"stop_outreach","when":"true"},{"from":"not_granted","to":"finish","when":"false"},{"from":"stop_outreach","to":"finish"}]}'::jsonb);
--> statement-breakpoint
UPDATE automation_versions version
SET definition = template.definition,
    checksum = encode(digest(template.definition::text, 'sha256'), 'hex')
FROM automation_definitions definition
JOIN crm_safe_default_automation_updates template ON template.code = definition.code
WHERE version.workspace_id = definition.workspace_id
  AND version.definition_id = definition.id
  AND version.version_number = 1
  AND version.published_at IS NULL
  AND definition.status = 'draft'
  AND version.definition = template.legacy_definition;
--> statement-breakpoint
UPDATE automation_definitions definition
SET description = template.description,
    updated_at = now(),
    version = version + 1
FROM crm_safe_default_automation_updates template
WHERE definition.code = template.code
  AND definition.status = 'draft'
  AND EXISTS (
    SELECT 1 FROM automation_versions version
    WHERE version.workspace_id = definition.workspace_id
      AND version.definition_id = definition.id
      AND version.version_number = 1
      AND version.definition = template.definition
  );
