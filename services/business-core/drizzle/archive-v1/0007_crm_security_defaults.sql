CREATE EXTENSION IF NOT EXISTS "pg_trgm";

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_parties', 'crm_person_profiles', 'crm_organization_profiles',
    'crm_relationships', 'crm_contact_points', 'crm_addresses', 'crm_consents',
    'crm_merge_operations', 'crm_intake_events', 'crm_enquiries',
    'crm_attribution_touches', 'crm_identity_candidates', 'crm_queues',
    'crm_queue_members', 'crm_assignment_policies', 'crm_assignment_rules',
    'crm_leads', 'crm_lead_qualification_values', 'crm_assignment_history',
    'crm_sla_policies', 'crm_sla_instances', 'crm_activities', 'crm_appointments',
    'crm_conversations', 'crm_conversation_participants', 'crm_messages',
    'crm_message_attachments', 'crm_sequences', 'crm_sequence_steps',
    'crm_sequence_enrollments', 'crm_pipelines', 'crm_pipeline_stages',
    'crm_opportunities', 'crm_opportunity_stakeholders', 'crm_opportunity_team',
    'crm_stage_history', 'crm_forecast_snapshots', 'crm_project_links',
    'crm_taxonomies', 'crm_taxonomy_options', 'crm_custom_field_definitions',
    'crm_custom_field_values', 'crm_qualification_forms',
    'crm_qualification_questions', 'crm_saved_views', 'automation_definitions',
    'automation_versions', 'automation_runs', 'automation_step_runs',
    'automation_waits', 'automation_approvals', 'notification_policies',
    'notification_templates', 'notifications', 'notification_delivery_attempts',
    'notification_preferences', 'device_endpoints'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = NULLIF(current_setting(''app.current_workspace_id'', true), '''')::uuid) WITH CHECK (workspace_id = NULLIF(current_setting(''app.current_workspace_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'crm_parties', 'crm_person_profiles', 'crm_organization_profiles',
    'crm_relationships', 'crm_contact_points', 'crm_addresses', 'crm_consents',
    'crm_intake_events', 'crm_enquiries', 'crm_identity_candidates', 'crm_queues',
    'crm_queue_members', 'crm_assignment_policies', 'crm_assignment_rules',
    'crm_leads', 'crm_sla_policies', 'crm_sla_instances', 'crm_activities',
    'crm_appointments', 'crm_conversations', 'crm_messages', 'crm_sequences',
    'crm_sequence_steps', 'crm_sequence_enrollments', 'crm_pipelines',
    'crm_pipeline_stages', 'crm_opportunities', 'crm_project_links',
    'crm_taxonomies', 'crm_taxonomy_options', 'crm_custom_field_definitions',
    'crm_custom_field_values', 'crm_qualification_forms',
    'crm_qualification_questions', 'crm_saved_views', 'automation_definitions',
    'automation_runs', 'automation_waits', 'automation_approvals',
    'notification_policies', 'notification_templates', 'notifications',
    'notification_preferences', 'device_endpoints'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- The generic guard from migration 0001 verifies that every tenant child points to
-- a parent inside the same workspace. User and currency references are global and
-- intentionally excluded.
DO $$
DECLARE
  relation text;
  child_table text;
  parent_table text;
  child_column text;
  trigger_name text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'crm_parties|legal_entities|legal_entity_id',
    'crm_parties|business_units|business_unit_id',
    'crm_parties|workspace_memberships|owner_membership_id',
    'crm_parties|crm_parties|merged_into_party_id',
    'crm_person_profiles|crm_parties|party_id',
    'crm_organization_profiles|crm_parties|party_id',
    'crm_relationships|crm_parties|from_party_id',
    'crm_relationships|crm_parties|to_party_id',
    'crm_contact_points|crm_parties|party_id',
    'crm_addresses|crm_parties|party_id',
    'crm_consents|crm_parties|party_id',
    'crm_consents|legal_entities|legal_entity_id',
    'crm_merge_operations|crm_parties|survivor_party_id',
    'crm_merge_operations|crm_parties|merged_party_id',
    'crm_intake_events|legal_entities|legal_entity_id',
    'crm_intake_events|business_units|business_unit_id',
    'crm_enquiries|crm_intake_events|intake_event_id',
    'crm_enquiries|crm_parties|party_id',
    'crm_attribution_touches|crm_enquiries|enquiry_id',
    'crm_identity_candidates|crm_intake_events|intake_event_id',
    'crm_identity_candidates|crm_parties|candidate_party_id',
    'crm_queues|business_units|business_unit_id',
    'crm_queue_members|crm_queues|queue_id',
    'crm_queue_members|workspace_memberships|membership_id',
    'crm_assignment_policies|crm_queues|fallback_queue_id',
    'crm_assignment_rules|crm_assignment_policies|policy_id',
    'crm_assignment_rules|crm_queues|queue_id',
    'crm_leads|crm_enquiries|enquiry_id',
    'crm_leads|crm_parties|party_id',
    'crm_leads|workspace_memberships|owner_membership_id',
    'crm_leads|crm_queues|queue_id',
    'crm_lead_qualification_values|crm_leads|lead_id',
    'crm_assignment_history|crm_leads|lead_id',
    'crm_assignment_history|workspace_memberships|previous_owner_membership_id',
    'crm_assignment_history|workspace_memberships|owner_membership_id',
    'crm_assignment_history|crm_queues|queue_id',
    'crm_assignment_history|crm_assignment_rules|rule_id',
    'crm_sla_instances|crm_sla_policies|policy_id',
    'crm_sla_instances|crm_leads|lead_id',
    'crm_activities|crm_parties|party_id',
    'crm_activities|crm_leads|lead_id',
    'crm_activities|workspace_memberships|owner_membership_id',
    'crm_appointments|crm_activities|activity_id',
    'crm_conversations|crm_parties|party_id',
    'crm_conversations|crm_leads|lead_id',
    'crm_conversations|workspace_memberships|owner_membership_id',
    'crm_conversation_participants|crm_conversations|conversation_id',
    'crm_messages|crm_conversations|conversation_id',
    'crm_message_attachments|crm_messages|message_id',
    'crm_sequence_steps|crm_sequences|sequence_id',
    'crm_sequence_enrollments|crm_sequences|sequence_id',
    'crm_sequence_enrollments|crm_parties|party_id',
    'crm_sequence_enrollments|crm_leads|lead_id',
    'crm_pipeline_stages|crm_pipelines|pipeline_id',
    'crm_opportunities|legal_entities|legal_entity_id',
    'crm_opportunities|business_units|business_unit_id',
    'crm_opportunities|crm_parties|party_id',
    'crm_opportunities|crm_leads|lead_id',
    'crm_opportunities|crm_pipelines|pipeline_id',
    'crm_opportunities|crm_pipeline_stages|stage_id',
    'crm_opportunities|workspace_memberships|owner_membership_id',
    'crm_opportunity_stakeholders|crm_opportunities|opportunity_id',
    'crm_opportunity_stakeholders|crm_parties|party_id',
    'crm_opportunity_team|crm_opportunities|opportunity_id',
    'crm_opportunity_team|workspace_memberships|membership_id',
    'crm_stage_history|crm_opportunities|opportunity_id',
    'crm_stage_history|crm_pipeline_stages|from_stage_id',
    'crm_stage_history|crm_pipeline_stages|to_stage_id',
    'crm_forecast_snapshots|crm_opportunities|opportunity_id',
    'crm_forecast_snapshots|workspace_memberships|owner_membership_id',
    'crm_forecast_snapshots|crm_pipeline_stages|stage_id',
    'crm_project_links|crm_opportunities|opportunity_id',
    'crm_taxonomy_options|crm_taxonomies|taxonomy_id',
    'crm_custom_field_values|crm_custom_field_definitions|definition_id',
    'crm_qualification_questions|crm_qualification_forms|form_id',
    'crm_saved_views|workspace_memberships|owner_membership_id',
    'automation_versions|automation_definitions|definition_id',
    'automation_runs|automation_definitions|definition_id',
    'automation_runs|automation_versions|version_id',
    'automation_step_runs|automation_runs|run_id',
    'automation_waits|automation_runs|run_id',
    'automation_approvals|automation_runs|run_id',
    'automation_approvals|workspace_memberships|requested_from_membership_id',
    'notifications|notification_policies|policy_id',
    'notifications|notification_templates|template_id',
    'notification_delivery_attempts|notifications|notification_id'
  ]
  LOOP
    child_table := split_part(relation, '|', 1);
    parent_table := split_part(relation, '|', 2);
    child_column := split_part(relation, '|', 3);
    trigger_name := left(child_table || '_' || child_column || '_workspace_guard', 63);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION enforce_same_workspace_reference(%L, %L)',
      trigger_name, child_table, parent_table, child_column
    );
  END LOOP;
END $$;
--> statement-breakpoint

ALTER TABLE crm_parties
  ADD CONSTRAINT crm_parties_merged_into_party_fk
  FOREIGN KEY (merged_into_party_id) REFERENCES crm_parties(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE crm_activities
  ADD CONSTRAINT crm_activities_opportunity_fk
  FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE crm_activities
  ADD CONSTRAINT crm_activities_target_check
  CHECK (num_nonnulls(party_id, lead_id, opportunity_id) >= 1);
--> statement-breakpoint
ALTER TABLE crm_conversation_participants
  ADD CONSTRAINT crm_conversation_participants_type_check
  CHECK (participant_type IN ('party', 'membership'));
--> statement-breakpoint
ALTER TABLE crm_contact_points
  ADD CONSTRAINT crm_contact_points_verified_check
  CHECK (NOT is_verified OR (normalized_value IS NOT NULL AND verified_at IS NOT NULL));
--> statement-breakpoint
ALTER TABLE crm_opportunities
  ADD CONSTRAINT crm_opportunities_reporting_money_check
  CHECK (
    (reporting_amount IS NULL AND reporting_currency_code IS NULL AND exchange_rate IS NULL AND exchange_rate_at IS NULL)
    OR
    (reporting_amount IS NOT NULL AND reporting_currency_code IS NOT NULL AND exchange_rate IS NOT NULL AND exchange_rate_at IS NOT NULL)
  );
--> statement-breakpoint

CREATE INDEX crm_parties_name_trgm_idx
  ON crm_parties USING gin (normalized_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX crm_organization_domain_trgm_idx
  ON crm_organization_profiles USING gin (website_domain gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX crm_messages_body_search_idx
  ON crm_messages USING gin (to_tsvector('simple', coalesce(body_text, '')));
--> statement-breakpoint
CREATE UNIQUE INDEX crm_activities_active_lead_next_uidx
  ON crm_activities (workspace_id, lead_id)
  WHERE lead_id IS NOT NULL AND is_next_action AND status = 'pending';
CREATE UNIQUE INDEX crm_activities_active_opportunity_next_uidx
  ON crm_activities (workspace_id, opportunity_id)
  WHERE opportunity_id IS NOT NULL AND is_next_action AND status = 'pending';
--> statement-breakpoint
DROP INDEX crm_consents_scope_uidx;
CREATE UNIQUE INDEX crm_consents_scope_uidx
  ON crm_consents (workspace_id, party_id, legal_entity_id, purpose, channel)
  NULLS NOT DISTINCT;
--> statement-breakpoint

INSERT INTO permissions (code, description) VALUES
  ('crm.parties.view', 'View CRM people, organizations, households, and relationships'),
  ('crm.parties.manage', 'Create and update CRM parties and relationship data'),
  ('crm.parties.export', 'Export CRM party data'),
  ('crm.parties.merge', 'Review duplicates and merge CRM parties'),
  ('crm.consent.manage', 'Manage communication consent and privacy preferences'),
  ('crm.leads.view', 'View CRM enquiries, leads, assignment, and SLA state'),
  ('crm.leads.manage', 'Create and update enquiries, leads, and qualification'),
  ('crm.leads.assign', 'Assign and reassign CRM leads'),
  ('crm.opportunities.view', 'View sales pipelines, opportunities, and forecast values'),
  ('crm.opportunities.manage', 'Create and update CRM opportunities and stakeholders'),
  ('crm.opportunities.transition', 'Move opportunities between pipeline stages and outcomes'),
  ('crm.opportunities.sensitive_values', 'View and update sensitive opportunity values'),
  ('crm.activities.view', 'View CRM activities, appointments, and next actions'),
  ('crm.activities.manage', 'Create and update CRM activities and appointments'),
  ('crm.communications.view', 'View CRM conversations and messages'),
  ('crm.communications.send', 'Send approved customer communications'),
  ('crm.settings.manage', 'Manage CRM pipelines, taxonomies, forms, fields, queues, and SLA policies'),
  ('crm.automations.view', 'View CRM automation definitions and execution history'),
  ('crm.automations.manage', 'Create, publish, pause, and replay CRM automations'),
  ('crm.automations.publish', 'Publish, pause, and approve CRM automations'),
  ('crm.notifications.view', 'View CRM notifications and delivery state'),
  ('crm.notifications.manage', 'Manage CRM notification policies and templates'),
  ('crm.reports.view', 'View CRM funnel, SLA, attribution, assignment, and forecast reports'),
  ('crm.privacy.erase', 'Authorize regulated CRM data pseudonymization')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint

-- Existing owners and administrators receive the new capabilities. New workspaces
-- already grant those roles every registered permission during bootstrap.
ALTER TABLE workspaces DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions DISABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
DECLARE
  workspace_record record;
BEGIN
  FOR workspace_record IN SELECT id FROM workspaces LOOP
    PERFORM set_config('app.current_workspace_id', workspace_record.id::text, true);

    INSERT INTO role_permissions (workspace_id, role_id, permission_id)
    SELECT role.workspace_id, role.id, permission.id
    FROM roles role
    CROSS JOIN permissions permission
    WHERE role.workspace_id = workspace_record.id
      AND role.code IN ('owner', 'administrator')
      AND permission.code LIKE 'crm.%'
    ON CONFLICT DO NOTHING;

    INSERT INTO role_permissions (workspace_id, role_id, permission_id)
    SELECT role.workspace_id, role.id, permission.id
    FROM roles role
    JOIN permissions permission ON permission.code IN (
      'crm.parties.view', 'crm.parties.manage', 'crm.leads.view', 'crm.leads.manage',
      'crm.activities.view', 'crm.activities.manage', 'crm.communications.view',
      'crm.communications.send', 'crm.opportunities.view', 'crm.opportunities.manage',
      'crm.notifications.view', 'crm.reports.view'
    )
    WHERE role.workspace_id = workspace_record.id AND role.code = 'member'
    ON CONFLICT DO NOTHING;

    INSERT INTO role_permissions (workspace_id, role_id, permission_id)
    SELECT role.workspace_id, role.id, permission.id
    FROM roles role
    JOIN permissions permission ON permission.code IN (
      'crm.parties.view', 'crm.leads.view', 'crm.activities.view',
      'crm.communications.view', 'crm.opportunities.view',
      'crm.notifications.view', 'crm.reports.view'
    )
    WHERE role.workspace_id = workspace_record.id AND role.code = 'viewer'
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
