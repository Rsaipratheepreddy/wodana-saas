-- Go-live reset: clear one workspace's business records in place and keep its configuration.
--
-- workspace_record_classification says, for every table with a workspace_id, whether the reset keeps it,
-- clears it, clears only the rows tied to cleared records (clear_linked), resets it (record numbering
-- counters) or prunes it (files: the storage ledger). It mirrors
-- src/workspaces/workspace-clear-records.classification.ts; the guard test keeps both in step, and the
-- function refuses to run while any tenant table is unclassified. A migration that adds a tenant table
-- adds its row here (INSERT ... ON CONFLICT (table_name) DO UPDATE).
CREATE TABLE workspace_record_classification (
  table_name text PRIMARY KEY CHECK (table_name ~ '^[a-z][a-z0-9_]*$'),
  disposition text NOT NULL CHECK (disposition IN ('keep', 'clear', 'clear_linked', 'reset', 'files')),
  clear_predicate text,
  file_columns text[] NOT NULL DEFAULT '{}',
  CONSTRAINT workspace_record_classification_predicate_check CHECK ((disposition = 'clear_linked') = (clear_predicate IS NOT NULL))
);
--> statement-breakpoint
REVOKE ALL ON workspace_record_classification FROM PUBLIC;
--> statement-breakpoint
INSERT INTO workspace_record_classification (table_name, disposition, clear_predicate, file_columns) VALUES
  ('accounting_contacts', 'clear', NULL, '{}'),
  ('accounting_links', 'keep', NULL, '{}'),
  ('accounting_postings', 'clear', NULL, '{}'),
  ('accounting_tax_codes', 'keep', NULL, '{}'),
  ('ai_agent_runs', 'clear', NULL, '{}'),
  ('ai_credit_accounts', 'keep', NULL, '{}'),
  ('ai_credit_ledger', 'keep', NULL, '{}'),
  ('ai_suggestion_decisions', 'clear', NULL, '{}'),
  ('ai_suggestions', 'clear', NULL, '{}'),
  ('ai_tool_calls', 'clear', NULL, '{}'),
  ('ai_usage_events', 'keep', NULL, '{}'),
  ('approval_decisions', 'clear', NULL, '{}'),
  ('approval_delegations', 'keep', NULL, '{}'),
  ('approval_policies', 'keep', NULL, '{}'),
  ('approval_policy_steps', 'keep', NULL, '{}'),
  ('approval_policy_versions', 'keep', NULL, '{}'),
  ('approval_requests', 'clear', NULL, '{}'),
  ('audit_events', 'keep', NULL, '{}'),
  ('auth_mfa_challenges', 'keep', NULL, '{}'),
  ('automation_approvals', 'clear', NULL, '{}'),
  ('automation_definitions', 'keep', NULL, '{}'),
  ('automation_runs', 'clear', NULL, '{}'),
  ('automation_step_runs', 'clear', NULL, '{}'),
  ('automation_versions', 'keep', NULL, '{}'),
  ('automation_waits', 'clear', NULL, '{}'),
  ('availability_overrides', 'keep', NULL, '{}'),
  ('booking_external_busy', 'keep', NULL, '{}'),
  ('booking_type_hosts', 'keep', NULL, '{}'),
  ('booking_types', 'keep', NULL, '{}'),
  ('bookings', 'clear', NULL, '{}'),
  ('building_permits', 'clear', NULL, ARRAY['file_key']),
  ('business_units', 'keep', NULL, '{}'),
  ('catalog_attributes', 'keep', NULL, '{}'),
  ('catalog_categories', 'keep', NULL, '{}'),
  ('catalog_components', 'clear', NULL, '{}'),
  ('catalog_item_conversions', 'clear', NULL, '{}'),
  ('catalog_item_dimensions', 'clear', NULL, '{}'),
  ('catalog_item_images', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('catalog_item_values', 'clear', NULL, '{}'),
  ('catalog_items', 'clear', NULL, '{}'),
  ('catalog_supplier_links', 'clear', NULL, '{}'),
  ('catalog_units', 'keep', NULL, '{}'),
  ('catalog_variant_values', 'clear', NULL, '{}'),
  ('catalog_variants', 'clear', NULL, '{}'),
  ('catalogs', 'keep', NULL, '{}'),
  ('change_request_events', 'clear', NULL, '{}'),
  ('change_request_lines', 'clear', NULL, '{}'),
  ('change_request_po_impacts', 'clear', NULL, '{}'),
  ('change_requests', 'clear', NULL, '{}'),
  ('client_credit_notes', 'clear', NULL, '{}'),
  ('client_invoice_lines', 'clear', NULL, '{}'),
  ('client_invoices', 'clear', NULL, '{}'),
  ('client_portal_attachments', 'clear', NULL, '{}'),
  ('client_portal_board_comments', 'clear', NULL, '{}'),
  ('client_portal_challenges', 'clear', NULL, '{}'),
  ('client_portal_commands', 'clear', NULL, '{}'),
  ('client_portal_devices', 'clear', NULL, '{}'),
  ('client_portal_grants', 'clear', NULL, '{}'),
  ('client_portal_invitations', 'clear', NULL, '{}'),
  ('client_portal_issues', 'clear', NULL, '{}'),
  ('client_portal_payment_notices', 'clear', NULL, '{}'),
  ('client_portal_project_access', 'clear', NULL, '{}'),
  ('client_portal_reactions', 'clear', NULL, '{}'),
  ('client_portal_reads', 'clear', NULL, '{}'),
  ('client_portal_sessions', 'clear', NULL, '{}'),
  ('client_portal_settings', 'keep', NULL, '{}'),
  ('client_portal_visits', 'clear', NULL, '{}'),
  ('client_update_calls', 'clear', NULL, '{}'),
  ('commercial_allocations', 'clear', NULL, '{}'),
  ('commercial_cases', 'clear', NULL, '{}'),
  ('commercial_deal_files', 'clear', NULL, '{}'),
  ('commercial_payment_templates', 'keep', NULL, '{}'),
  ('commercial_payments', 'clear', NULL, '{}'),
  ('commercial_quotation_templates', 'keep', NULL, '{}'),
  ('commercial_quote_discounts', 'clear', NULL, '{}'),
  ('commercial_quote_line_components', 'clear', NULL, '{}'),
  ('commercial_quote_line_values', 'clear', NULL, '{}'),
  ('commercial_quote_lines', 'clear', NULL, '{}'),
  ('commercial_quote_messages', 'clear', NULL, '{}'),
  ('commercial_quote_presence', 'clear', NULL, '{}'),
  ('commercial_quote_threads', 'clear', NULL, '{}'),
  ('commercial_quotes', 'clear', NULL, '{}'),
  ('commercial_receipts', 'clear', NULL, '{}'),
  ('commercial_reconciliation_jobs', 'clear', NULL, '{}'),
  ('crm_activities', 'clear', NULL, '{}'),
  ('crm_addresses', 'clear', NULL, '{}'),
  ('crm_appointments', 'clear', NULL, '{}'),
  ('crm_assignment_history', 'clear', NULL, '{}'),
  ('crm_assignment_policies', 'keep', NULL, '{}'),
  ('crm_assignment_rules', 'keep', NULL, '{}'),
  ('crm_attribution_touches', 'clear', NULL, '{}'),
  ('crm_auto_replies', 'clear', NULL, '{}'),
  ('crm_auto_reply_settings', 'keep', NULL, '{}'),
  ('crm_client_message_rules', 'keep', NULL, '{}'),
  ('crm_consents', 'clear', NULL, '{}'),
  ('crm_contact_points', 'clear', NULL, '{}'),
  ('crm_conversation_events', 'clear', NULL, '{}'),
  ('crm_conversation_label_links', 'clear', NULL, '{}'),
  ('crm_conversation_labels', 'keep', NULL, '{}'),
  ('crm_conversation_participants', 'clear', NULL, '{}'),
  ('crm_conversations', 'clear', NULL, '{}'),
  ('crm_custom_field_definitions', 'keep', NULL, '{}'),
  ('crm_custom_field_values', 'clear', NULL, '{}'),
  ('crm_deal_fulfilment', 'clear', NULL, '{}'),
  ('crm_deal_fulfilment_events', 'clear', NULL, '{}'),
  ('crm_email_messages', 'clear', NULL, '{}'),
  ('crm_enquiries', 'clear', NULL, '{}'),
  ('crm_enquiry_counters', 'reset', NULL, '{}'),
  ('crm_enquiry_field_settings', 'keep', NULL, '{}'),
  ('crm_enquiry_requirements', 'keep', NULL, '{}'),
  ('crm_flow_closing_rules', 'keep', NULL, '{}'),
  ('crm_flow_fulfilment_rules', 'keep', NULL, '{}'),
  ('crm_flow_versions', 'keep', NULL, '{}'),
  ('crm_flow_won_areas', 'keep', NULL, '{}'),
  ('crm_flows', 'keep', NULL, '{}'),
  ('crm_forecast_snapshots', 'clear', NULL, '{}'),
  ('crm_identity_candidates', 'clear', NULL, '{}'),
  ('crm_inbound_email_addresses', 'keep', NULL, '{}'),
  ('crm_inbox_settings', 'keep', NULL, '{}'),
  ('crm_intake_events', 'clear', NULL, '{}'),
  ('crm_lead_forms', 'keep', NULL, '{}'),
  ('crm_lead_qualification_values', 'clear', NULL, '{}'),
  ('crm_lead_team', 'clear', NULL, '{}'),
  ('crm_leads', 'clear', NULL, '{}'),
  ('crm_merge_operations', 'clear', NULL, '{}'),
  ('crm_message_attachments', 'clear', NULL, ARRAY['object_key']),
  ('crm_messages', 'clear', NULL, '{}'),
  ('crm_opportunities', 'clear', NULL, '{}'),
  ('crm_opportunity_counters', 'reset', NULL, '{}'),
  ('crm_opportunity_designer', 'clear', NULL, '{}'),
  ('crm_opportunity_designer_history', 'clear', NULL, '{}'),
  ('crm_opportunity_discovery', 'clear', NULL, '{}'),
  ('crm_opportunity_discovery_values', 'clear', NULL, '{}'),
  ('crm_opportunity_payment_proofs', 'clear', NULL, ARRAY['storage_key']),
  ('crm_opportunity_proposals', 'clear', NULL, '{}'),
  ('crm_opportunity_stakeholders', 'clear', NULL, '{}'),
  ('crm_opportunity_step_skips', 'clear', NULL, '{}'),
  ('crm_opportunity_team', 'clear', NULL, '{}'),
  ('crm_opportunity_value_events', 'clear', NULL, '{}'),
  ('crm_organization_profiles', 'clear', NULL, '{}'),
  ('crm_parties', 'clear', NULL, '{}'),
  ('crm_payment_reminders', 'clear', NULL, '{}'),
  ('crm_person_profiles', 'clear', NULL, '{}'),
  ('crm_pipeline_stages', 'keep', NULL, '{}'),
  ('crm_pipelines', 'keep', NULL, '{}'),
  ('crm_project_links', 'clear', NULL, '{}'),
  ('crm_qualification_forms', 'keep', NULL, '{}'),
  ('crm_qualification_questions', 'keep', NULL, '{}'),
  ('crm_queue_members', 'keep', NULL, '{}'),
  ('crm_queues', 'keep', NULL, '{}'),
  ('crm_quick_replies', 'keep', NULL, '{}'),
  ('crm_relationships', 'clear', NULL, '{}'),
  ('crm_sales_digests', 'clear', NULL, '{}'),
  ('crm_saved_views', 'keep', NULL, '{}'),
  ('crm_scheduled_messages', 'clear', NULL, '{}'),
  ('crm_sequence_enrollments', 'clear', NULL, '{}'),
  ('crm_sequence_steps', 'keep', NULL, '{}'),
  ('crm_sequences', 'keep', NULL, '{}'),
  ('crm_sla_history', 'clear', NULL, '{}'),
  ('crm_sla_instances', 'clear', NULL, '{}'),
  ('crm_sla_policies', 'keep', NULL, '{}'),
  ('crm_stage_history', 'clear', NULL, '{}'),
  ('crm_taxonomies', 'keep', NULL, '{}'),
  ('crm_taxonomy_options', 'keep', NULL, '{}'),
  ('crm_template_variables', 'keep', NULL, '{}'),
  ('customer_account_organizations', 'keep', NULL, '{}'),
  ('delivery_projects', 'clear', NULL, '{}'),
  ('design_journey_events', 'clear', NULL, '{}'),
  ('design_journey_stages', 'clear', NULL, '{}'),
  ('design_journeys', 'clear', NULL, '{}'),
  ('design_ledger_alternatives', 'clear', NULL, '{}'),
  ('design_ledger_entries', 'clear', NULL, '{}'),
  ('design_ledger_lock_lines', 'clear', NULL, '{}'),
  ('design_ledger_locks', 'clear', NULL, '{}'),
  ('design_ledger_versions', 'clear', NULL, '{}'),
  ('design_packages', 'keep', NULL, '{}'),
  ('design_presentation_options', 'clear', NULL, '{}'),
  ('design_presentations', 'clear', NULL, '{}'),
  ('design_site_visit_answers', 'clear', NULL, '{}'),
  ('design_work_bookings', 'clear', NULL, '{}'),
  ('device_endpoints', 'keep', NULL, '{}'),
  ('document_sequences', 'keep', NULL, '{}'),
  ('esign_requests', 'clear', NULL, '{}'),
  ('exchange_rates', 'keep', NULL, '{}'),
  ('factory_commands', 'clear', NULL, '{}'),
  ('factory_ready_reminders', 'clear', NULL, '{}'),
  ('finance_payment_methods', 'keep', NULL, '{}'),
  ('finance_request_commands', 'clear', NULL, '{}'),
  ('finance_request_events', 'clear', NULL, '{}'),
  ('finance_request_files', 'clear', NULL, ARRAY['storage_key']),
  ('finance_request_lines', 'clear', NULL, '{}'),
  ('finance_request_settings', 'keep', NULL, '{}'),
  ('finance_requests', 'clear', NULL, '{}'),
  ('fit_check_overrides', 'clear', NULL, '{}'),
  ('fulfilment_commands', 'clear', NULL, '{}'),
  ('goods_receipt_lines', 'clear', NULL, '{}'),
  ('goods_receipt_photos', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('goods_receipts', 'clear', NULL, '{}'),
  ('handover_documents', 'clear', NULL, ARRAY['object_key']),
  ('handover_packs', 'clear', NULL, '{}'),
  ('hrms_attendance_events', 'clear', NULL, '{}'),
  ('hrms_calendars', 'keep', NULL, '{}'),
  ('hrms_captures', 'clear', NULL, ARRAY['object_key']),
  ('hrms_crew_day_workers', 'clear', NULL, '{}'),
  ('hrms_crew_days', 'clear', NULL, '{}'),
  ('hrms_crews', 'clear', NULL, '{}'),
  ('hrms_documents', 'clear_linked', 'worker_id IS NOT NULL', ARRAY['object_key']),
  ('hrms_employees', 'keep', NULL, '{}'),
  ('hrms_holidays', 'keep', NULL, '{}'),
  ('hrms_leave_allowances', 'keep', NULL, '{}'),
  ('hrms_leave_requests', 'clear', NULL, '{}'),
  ('hrms_leave_types', 'keep', NULL, '{}'),
  ('hrms_reviews', 'clear', NULL, '{}'),
  ('hrms_segments', 'clear', NULL, '{}'),
  ('hrms_sessions', 'clear', NULL, '{}'),
  ('hrms_settings', 'keep', NULL, '{}'),
  ('hrms_site_access', 'clear', NULL, '{}'),
  ('hrms_time_entries', 'clear', NULL, '{}'),
  ('hrms_timesheets', 'clear', NULL, '{}'),
  ('hrms_workers', 'clear', NULL, '{}'),
  ('idempotency_keys', 'clear', NULL, '{}'),
  ('import_link_records', 'clear', NULL, '{}'),
  ('import_links', 'clear', NULL, '{}'),
  ('import_run_rows', 'clear', NULL, '{}'),
  ('import_runs', 'clear', NULL, '{}'),
  ('integration_connections', 'keep', NULL, '{}'),
  ('integration_resources', 'keep', NULL, '{}'),
  ('invitation_roles', 'keep', NULL, '{}'),
  ('invitation_teams', 'keep', NULL, '{}'),
  ('job_identities', 'clear', NULL, '{}'),
  ('job_identity_link_events', 'clear', NULL, '{}'),
  ('job_identity_links', 'clear', NULL, '{}'),
  ('job_manual_stage_events', 'clear', NULL, '{}'),
  ('job_manual_stages', 'clear', NULL, '{}'),
  ('job_reference_counters', 'reset', NULL, '{}'),
  ('legal_entities', 'keep', NULL, '{}'),
  ('link_previews', 'clear', NULL, ARRAY['image_key', 'image_preview_key']),
  ('logistics_assignment_people', 'clear', NULL, '{}'),
  ('logistics_assignments', 'clear', NULL, '{}'),
  ('logistics_vehicles', 'keep', NULL, '{}'),
  ('management_report_target_commands', 'keep', NULL, '{}'),
  ('management_report_targets', 'keep', NULL, '{}'),
  ('mcp_authorization_codes', 'keep', NULL, '{}'),
  ('mcp_connections', 'keep', NULL, '{}'),
  ('mcp_rate_windows', 'keep', NULL, '{}'),
  ('mcp_tokens', 'keep', NULL, '{}'),
  ('member_roles', 'keep', NULL, '{}'),
  ('mfa_security_events', 'keep', NULL, '{}'),
  ('notification_delivery_attempts', 'clear', NULL, '{}'),
  ('notification_device_consents', 'keep', NULL, '{}'),
  ('notification_policies', 'keep', NULL, '{}'),
  ('notification_preferences', 'keep', NULL, '{}'),
  ('notification_templates', 'keep', NULL, '{}'),
  ('notifications', 'clear', NULL, '{}'),
  ('one_tree_node_revisions', 'clear', NULL, '{}'),
  ('one_tree_nodes', 'clear', NULL, '{}'),
  ('organization_billing_allocation_versions', 'keep', NULL, '{}'),
  ('organization_entitlement_allocations', 'keep', NULL, '{}'),
  ('outbox_events', 'clear', NULL, '{}'),
  ('payment_run_items', 'clear', NULL, '{}'),
  ('payment_runs', 'clear', NULL, '{}'),
  ('petty_cash_claims', 'clear', NULL, ARRAY['receipt_key']),
  ('petty_cash_commands', 'clear', NULL, '{}'),
  ('pre_project_asset_markups', 'clear', NULL, '{}'),
  ('pre_project_brief_assets', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('pre_project_brief_entries', 'clear', NULL, '{}'),
  ('pre_project_briefs', 'clear', NULL, '{}'),
  ('pre_project_cases', 'clear', NULL, '{}'),
  ('pre_project_definition_baselines', 'clear', NULL, '{}'),
  ('pre_project_definition_commands', 'clear', NULL, '{}'),
  ('pre_project_definition_decisions', 'clear', NULL, '{}'),
  ('pre_project_design_activity', 'clear', NULL, '{}'),
  ('pre_project_design_folders', 'clear', NULL, '{}'),
  ('pre_project_design_messages', 'clear', NULL, '{}'),
  ('pre_project_design_threads', 'clear', NULL, '{}'),
  ('pre_project_design_versions', 'clear', NULL, '{}'),
  ('pre_project_designs', 'clear', NULL, '{}'),
  ('pre_project_entry_assets', 'clear', NULL, '{}'),
  ('pre_project_entry_requirement_links', 'clear', NULL, '{}'),
  ('pre_project_item_design_refs', 'clear', NULL, '{}'),
  ('pre_project_item_specifications', 'clear', NULL, '{}'),
  ('pre_project_lifecycle_commands', 'clear', NULL, '{}'),
  ('pre_project_moodboard_pins', 'clear', NULL, '{}'),
  ('pre_project_moodboard_shares', 'clear', NULL, '{}'),
  ('pre_project_rooms', 'clear', NULL, '{}'),
  ('pre_project_scope_links', 'clear', NULL, '{}'),
  ('pre_project_site_assets', 'clear', NULL, '{}'),
  ('pre_project_site_records', 'clear', NULL, '{}'),
  ('pre_project_site_revisions', 'clear', NULL, '{}'),
  ('pre_project_site_specification_refs', 'clear', NULL, '{}'),
  ('pre_project_specification_catalog_refs', 'clear', NULL, '{}'),
  ('price_books', 'keep', NULL, '{}'),
  ('price_entries', 'clear', NULL, '{}'),
  ('price_entry_surcharges', 'clear', NULL, '{}'),
  ('price_entry_tiers', 'clear', NULL, '{}'),
  ('price_request_lines', 'clear', NULL, '{}'),
  ('price_request_quotes', 'clear', NULL, '{}'),
  ('price_request_suppliers', 'clear', NULL, '{}'),
  ('price_requests', 'clear', NULL, '{}'),
  ('product_clip_fields', 'clear', NULL, '{}'),
  ('product_clip_images', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('product_clips', 'clear', NULL, '{}'),
  ('production_batches', 'clear', NULL, '{}'),
  ('project_assignments', 'clear', NULL, '{}'),
  ('project_booking_history', 'clear', NULL, '{}'),
  ('project_booking_slots', 'clear', NULL, '{}'),
  ('project_bookings', 'clear', NULL, '{}'),
  ('project_boq_events', 'clear', NULL, '{}'),
  ('project_boq_lines', 'clear', NULL, '{}'),
  ('project_budgets', 'clear', NULL, '{}'),
  ('project_drawing_files', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('project_drawing_revisions', 'clear', NULL, '{}'),
  ('project_execution', 'clear', NULL, '{}'),
  ('project_factory_allocations', 'clear', NULL, '{}'),
  ('project_factory_batches', 'clear', NULL, '{}'),
  ('project_factory_commands', 'clear', NULL, '{}'),
  ('project_material_decisions', 'clear', NULL, '{}'),
  ('project_material_items', 'clear', NULL, '{}'),
  ('project_material_revisions', 'clear', NULL, '{}'),
  ('project_materials_ready', 'clear', NULL, '{}'),
  ('project_packages', 'clear', NULL, '{}'),
  ('project_reference_counters', 'reset', NULL, '{}'),
  ('project_resources', 'clear', NULL, '{}'),
  ('project_scope_seals', 'clear', NULL, '{}'),
  ('project_stage_confirmations', 'clear', NULL, '{}'),
  ('project_stages', 'clear', NULL, '{}'),
  ('project_status_updates', 'clear', NULL, '{}'),
  ('project_stock_commands', 'clear', NULL, '{}'),
  ('project_stock_transfers', 'clear', NULL, '{}'),
  ('project_task_dependencies', 'clear', NULL, '{}'),
  ('project_tasks', 'clear', NULL, '{}'),
  ('project_team_not_applicable', 'clear', NULL, '{}'),
  ('project_template_stages', 'keep', NULL, '{}'),
  ('project_templates', 'keep', NULL, '{}'),
  ('project_update_photos', 'clear', NULL, '{}'),
  ('project_vendor_access', 'clear', NULL, '{}'),
  ('project_warehouse_stock', 'clear', NULL, '{}'),
  ('project_workflow_templates', 'keep', NULL, '{}'),
  ('proposal_template_pages', 'keep', NULL, '{}'),
  ('proposal_templates', 'keep', NULL, '{}'),
  ('purchase_line_blockers', 'clear', NULL, '{}'),
  ('purchase_order_events', 'clear', NULL, '{}'),
  ('purchase_order_lines', 'clear', NULL, '{}'),
  ('purchase_order_revisions', 'clear', NULL, '{}'),
  ('purchase_order_shipments', 'clear', NULL, '{}'),
  ('purchase_orders', 'clear', NULL, '{}'),
  ('purchasing_commands', 'clear', NULL, '{}'),
  ('quotation_columns', 'keep', NULL, '{}'),
  ('quotation_proposal_commands', 'clear', NULL, '{}'),
  ('quotation_proposal_runs', 'clear', NULL, '{}'),
  ('quotation_references', 'clear', NULL, '{}'),
  ('quote_document_versions', 'clear', NULL, ARRAY['object_key']),
  ('quote_documents', 'clear', NULL, '{}'),
  ('quote_issue_snapshots', 'clear', NULL, '{}'),
  ('quote_qs_reviews', 'clear', NULL, '{}'),
  ('role_permissions', 'keep', NULL, '{}'),
  ('roles', 'keep', NULL, '{}'),
  ('sample_requests', 'clear', NULL, '{}'),
  ('site_access_points', 'clear', NULL, '{}'),
  ('site_access_requests', 'clear', NULL, '{}'),
  ('site_report_issues', 'clear', NULL, '{}'),
  ('site_report_lines', 'clear', NULL, '{}'),
  ('site_report_materials', 'clear', NULL, '{}'),
  ('site_report_next', 'clear', NULL, '{}'),
  ('site_report_photos', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('site_report_reactions', 'clear', NULL, '{}'),
  ('site_report_rollups', 'clear', NULL, '{}'),
  ('site_report_tasks', 'clear', NULL, '{}'),
  ('site_report_workforce', 'clear', NULL, '{}'),
  ('site_reports', 'clear', NULL, '{}'),
  ('stock_adjustment_requests', 'clear', NULL, '{}'),
  ('stock_balances', 'clear', NULL, '{}'),
  ('stock_commands', 'clear', NULL, '{}'),
  ('stock_items', 'clear', NULL, '{}'),
  ('stock_locations', 'clear_linked', 'project_id IS NOT NULL', '{}'),
  ('stock_movements', 'clear', NULL, '{}'),
  ('stock_reorder_points', 'clear', NULL, '{}'),
  ('stock_reservations', 'clear', NULL, '{}'),
  ('stock_transfer_lines', 'clear', NULL, '{}'),
  ('stock_transfers', 'clear', NULL, '{}'),
  ('supplier_attributes', 'clear', NULL, '{}'),
  ('supplier_invoice_lines', 'clear', NULL, '{}'),
  ('supplier_invoice_retentions', 'clear', NULL, '{}'),
  ('supplier_invoices', 'clear', NULL, ARRAY['file_key']),
  ('supplier_payment_allocations', 'clear', NULL, '{}'),
  ('supplier_payments', 'clear', NULL, '{}'),
  ('supplier_rate_contract_lines', 'clear', NULL, '{}'),
  ('supplier_rate_contracts', 'clear', NULL, '{}'),
  ('supplier_retention_releases', 'clear', NULL, '{}'),
  ('supplier_return_lines', 'clear', NULL, '{}'),
  ('supplier_returns', 'clear', NULL, '{}'),
  ('sync_cursors', 'keep', NULL, '{}'),
  ('tax_profiles', 'keep', NULL, '{}'),
  ('tax_rates', 'keep', NULL, '{}'),
  ('team_calendar_pushes', 'clear', NULL, '{}'),
  ('tenant_control_notices', 'keep', NULL, '{}'),
  ('tenant_data_exports', 'keep', NULL, '{}'),
  ('tenant_lifecycle_versions', 'keep', NULL, '{}'),
  ('tenant_login_branding', 'keep', NULL, '{}'),
  ('tenant_operation_runs', 'keep', NULL, '{}'),
  ('tenant_provisioning_drafts', 'keep', NULL, '{}'),
  ('tenant_provisioning_requests', 'keep', NULL, '{}'),
  ('tenant_support_sessions', 'keep', NULL, '{}'),
  ('unmatched_deliveries', 'clear', NULL, '{}'),
  ('unmatched_delivery_lines', 'clear', NULL, '{}'),
  ('vendor_bank_accounts', 'clear', NULL, '{}'),
  ('vendor_documents', 'clear', NULL, ARRAY['object_key']),
  ('vendor_legal_entities', 'clear', NULL, '{}'),
  ('view_as_session_views', 'keep', NULL, '{}'),
  ('view_as_sessions', 'keep', NULL, '{}'),
  ('warranty_claims', 'clear', NULL, '{}'),
  ('warranty_defaults', 'keep', NULL, '{}'),
  ('warranty_items', 'clear', NULL, '{}'),
  ('webhook_inbox', 'clear', NULL, '{}'),
  ('work_item_comments', 'clear', NULL, '{}'),
  ('work_item_events', 'clear', NULL, '{}'),
  ('work_item_links', 'clear', NULL, '{}'),
  ('work_item_photos', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('work_items', 'clear', NULL, '{}'),
  ('work_locations', 'clear', NULL, '{}'),
  ('work_order_check_photos', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('work_order_checks', 'clear', NULL, '{}'),
  ('work_order_events', 'clear', NULL, '{}'),
  ('work_order_materials', 'clear', NULL, '{}'),
  ('work_order_operations', 'clear', NULL, '{}'),
  ('work_order_reports', 'clear', NULL, '{}'),
  ('work_order_reworks', 'clear', NULL, '{}'),
  ('work_orders', 'clear', NULL, '{}'),
  ('work_sprint_commitments', 'clear', NULL, '{}'),
  ('work_sprints', 'clear', NULL, '{}'),
  ('work_templates', 'keep', NULL, '{}'),
  ('workcenter_rates', 'keep', NULL, '{}'),
  ('workcenters', 'keep', NULL, '{}'),
  ('workspace_ai_settings', 'keep', NULL, '{}'),
  ('workspace_brand_assets', 'keep', NULL, '{}'),
  ('workspace_catalog_assets', 'clear', NULL, ARRAY['object_key', 'preview_key']),
  ('workspace_catalog_links', 'clear', NULL, '{}'),
  ('workspace_catalog_records', 'clear', NULL, '{}'),
  ('workspace_configuration_revisions', 'keep', NULL, '{}'),
  ('workspace_data_policies', 'keep', NULL, '{}'),
  ('workspace_design_settings', 'keep', NULL, '{}'),
  ('workspace_domains', 'keep', NULL, '{}'),
  ('workspace_entitlement_sets', 'keep', NULL, '{}'),
  ('workspace_factory_settings', 'keep', NULL, '{}'),
  ('workspace_galleries', 'keep', NULL, '{}'),
  ('workspace_gallery_images', 'keep', NULL, '{}'),
  ('workspace_gallery_items', 'keep', NULL, '{}'),
  ('workspace_grid_hidden_columns', 'keep', NULL, '{}'),
  ('workspace_grid_settings', 'keep', NULL, '{}'),
  ('workspace_invitation_delivery', 'keep', NULL, '{}'),
  ('workspace_invitation_delivery_commands', 'keep', NULL, '{}'),
  ('workspace_invitations', 'keep', NULL, '{}'),
  ('workspace_labour_rates', 'keep', NULL, '{}'),
  ('workspace_logistics_settings', 'keep', NULL, '{}'),
  ('workspace_member_profiles', 'keep', NULL, '{}'),
  ('workspace_memberships', 'keep', NULL, '{}'),
  ('workspace_object_cleanup_queue', 'keep', NULL, '{}'),
  ('workspace_onboarding', 'keep', NULL, '{}'),
  ('workspace_project_settings', 'keep', NULL, '{}'),
  ('workspace_proposal_kits', 'keep', NULL, '{}'),
  ('workspace_purchasing_settings', 'keep', NULL, '{}'),
  ('workspace_quotation_settings', 'keep', NULL, '{}'),
  ('workspace_sales_settings', 'keep', NULL, '{}'),
  ('workspace_setup_versions', 'keep', NULL, '{}'),
  ('workspace_stored_objects', 'files', NULL, '{}'),
  ('workspace_subscriptions', 'keep', NULL, '{}'),
  ('workspace_supplier_offer_commands', 'clear', NULL, '{}'),
  ('workspace_supplier_offers', 'clear', NULL, '{}'),
  ('workspace_team_calendars', 'keep', NULL, '{}'),
  ('workspace_team_members', 'keep', NULL, '{}'),
  ('workspace_team_queue_settings', 'keep', NULL, '{}'),
  ('workspace_team_roles', 'keep', NULL, '{}'),
  ('workspace_teams', 'keep', NULL, '{}'),
  ('workspace_terminology', 'keep', NULL, '{}'),
  ('workspace_vendor_sites', 'clear', NULL, '{}'),
  ('workspace_vendors', 'clear', NULL, '{}'),
  ('workspace_view_as_settings', 'keep', NULL, '{}'),
  ('workspace_work_packages', 'keep', NULL, '{}')
ON CONFLICT (table_name) DO UPDATE SET disposition = excluded.disposition,
  clear_predicate = excluded.clear_predicate, file_columns = excluded.file_columns;
--> statement-breakpoint
-- Storage objects of cleared rows, deleted by the business-core worker after the clear commits.
CREATE TABLE workspace_object_cleanup_queue (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_key text NOT NULL CHECK (length(object_key) BETWEEN 1 AND 1024),
  clear_run_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deleted', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (workspace_id, object_key)
);
--> statement-breakpoint
CREATE INDEX workspace_object_cleanup_queue_pending_idx ON workspace_object_cleanup_queue (workspace_id, created_at) WHERE status = 'pending';
--> statement-breakpoint
ALTER TABLE workspace_object_cleanup_queue ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace_object_cleanup_queue FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workspace_object_cleanup_queue
  USING (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.current_workspace_id', true), '')::uuid);
--> statement-breakpoint
-- The cleanup worker lists the workspaces with pending deletions, then works inside each one.
CREATE FUNCTION workspace_object_cleanup_workspaces() RETURNS TABLE (workspace_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT queue.workspace_id FROM workspace_object_cleanup_queue queue WHERE queue.status = 'pending'
$$;
--> statement-breakpoint
-- Clears one workspace's records. Refuses unless p_confirm_slug is the workspace's slug. With p_dry_run it
-- only counts. Runs inside the caller's transaction: every delete, the counter resets, the storage queue and
-- the audit event commit or roll back together.
--
-- Order: children before parents, computed from pg_constraint (foreign keys stay enforced). Self-references
-- with ON DELETE RESTRICT are removed leaf-first. Append-only guard triggers (BEFORE DELETE row triggers) on
-- the cleared tables are suspended for this transaction only: ALTER TABLE takes a lock that holds every other
-- writer of those tables until commit, and the triggers are enabled again before the function returns.
CREATE FUNCTION workspace_clear_records(p_workspace uuid, p_confirm_slug text, p_dry_run boolean)
RETURNS TABLE (table_name text, disposition text, row_count bigint, run_id uuid)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_slug text;
  v_current text := NULLIF(current_setting('app.current_workspace_id', true), '');
  v_actor uuid := NULLIF(current_setting('app.current_actor_id', true), '')::uuid;
  v_run uuid := CASE WHEN p_dry_run THEN NULL ELSE gen_random_uuid() END;
  v_missing text;
  v_next text;
  v_ord integer := 0;
  v_count bigint;
  v_deleted bigint;
  v_filter text;
  v_join text;
  v_column text;
  v_keys bigint;
  v_ledger bigint;
  v_outside bigint;
  v_counts jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_trigger record;
  v_suspended text[] := '{}';
  v_item text;
  r record;
  s record;
BEGIN
  IF p_workspace IS NULL OR p_confirm_slug IS NULL OR p_dry_run IS NULL THEN
    RAISE EXCEPTION 'Workspace, confirmation slug and dry-run flag are required' USING ERRCODE = '22004';
  END IF;
  IF v_current IS NOT NULL AND v_current <> p_workspace::text THEN
    RAISE EXCEPTION 'This transaction belongs to another workspace' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.current_workspace_id', p_workspace::text, true);
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-clear-records:' || p_workspace::text, 0));

  SELECT workspace.slug INTO v_slug FROM workspaces workspace WHERE workspace.id = p_workspace;
  IF v_slug IS NULL THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_slug IS DISTINCT FROM p_confirm_slug THEN
    RAISE EXCEPTION 'The confirmation does not match the workspace slug' USING ERRCODE = '22023';
  END IF;

  SELECT string_agg(relation.relname, ', ' ORDER BY relation.relname) INTO v_missing
    FROM pg_class relation
   WHERE relation.relnamespace = 'public'::regnamespace AND relation.relkind IN ('r', 'p') AND NOT relation.relispartition
     AND EXISTS (SELECT 1 FROM pg_attribute attribute WHERE attribute.attrelid = relation.oid
                  AND attribute.attname = 'workspace_id' AND NOT attribute.attisdropped)
     AND NOT EXISTS (SELECT 1 FROM workspace_record_classification class WHERE class.table_name = relation.relname);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Unclassified tenant tables: %', v_missing USING ERRCODE = '55000';
  END IF;

  IF to_regclass('pg_temp.wcr_plan') IS NOT NULL THEN
    DROP TABLE pg_temp.wcr_plan, pg_temp.wcr_edges, pg_temp.wcr_keys, pg_temp.wcr_kept;
  END IF;
  CREATE TEMP TABLE pg_temp.wcr_plan (
    table_name text PRIMARY KEY, disposition text NOT NULL, predicate text, file_columns text[] NOT NULL,
    row_count bigint NOT NULL DEFAULT 0, ord integer
  ) ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.wcr_edges (child text NOT NULL, parent text NOT NULL, hard boolean NOT NULL) ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.wcr_keys (object_key text PRIMARY KEY) ON COMMIT DROP;
  CREATE TEMP TABLE pg_temp.wcr_kept (blob text NOT NULL) ON COMMIT DROP;

  INSERT INTO pg_temp.wcr_plan (table_name, disposition, predicate, file_columns)
  SELECT class.table_name, class.disposition, class.clear_predicate, class.file_columns
    FROM workspace_record_classification class
   WHERE class.disposition <> 'keep' AND to_regclass(format('public.%I', class.table_name)) IS NOT NULL;

  -- Counts (the storage ledger is counted once the object keys are known).
  FOR r IN SELECT * FROM pg_temp.wcr_plan WHERE disposition <> 'files' ORDER BY table_name LOOP
    v_filter := CASE WHEN r.predicate IS NULL THEN '' ELSE format(' AND (%s)', r.predicate) END;
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE t.workspace_id = $1%s', r.table_name, v_filter)
      INTO v_count USING p_workspace;
    UPDATE pg_temp.wcr_plan SET row_count = v_count WHERE table_name = r.table_name;
  END LOOP;

  -- Object keys of the rows being removed.
  FOR r IN SELECT * FROM pg_temp.wcr_plan WHERE cardinality(file_columns) > 0 ORDER BY table_name LOOP
    v_filter := CASE WHEN r.predicate IS NULL THEN '' ELSE format(' AND (%s)', r.predicate) END;
    FOREACH v_column IN ARRAY r.file_columns LOOP
      EXECUTE format('INSERT INTO pg_temp.wcr_keys SELECT DISTINCT t.%I::text FROM public.%I t
                       WHERE t.workspace_id = $1 AND t.%I IS NOT NULL AND t.%I::text <> ''''%s ON CONFLICT DO NOTHING',
                     v_column, r.table_name, v_column, v_column, v_filter) USING p_workspace;
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_temp.wcr_plan WHERE table_name = 'project_execution') THEN
    INSERT INTO pg_temp.wcr_keys
    SELECT DISTINCT 'projects/' || execution.workspace_id || '/' || execution.project_id || '/' || (file.value->>'id')
      FROM project_execution execution
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(execution.content->'files') = 'array'
                                                   THEN execution.content->'files' ELSE '[]'::jsonb END) AS file(value)
     WHERE execution.workspace_id = p_workspace AND nullif(file.value->>'id', '') IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
  -- Only objects inside this workspace's own storage prefix are ever deleted.
  DELETE FROM pg_temp.wcr_keys WHERE strpos(object_key, p_workspace::text) = 0;
  GET DIAGNOSTICS v_outside = ROW_COUNT;
  -- An object still used by anything the reset keeps (branding, letterheads, proposal kit, gallery, member
  -- photos, staff documents, any configuration that names it) stays. Logs are not configuration.
  FOR r IN SELECT class.table_name, class.disposition, class.clear_predicate FROM workspace_record_classification class
            WHERE (class.disposition = 'keep' OR class.disposition = 'clear_linked')
              AND class.table_name <> ALL (ARRAY['audit_events', 'ai_usage_events', 'ai_credit_ledger', 'mfa_security_events',
                    'auth_mfa_challenges', 'tenant_lifecycle_versions', 'tenant_operation_runs', 'tenant_data_exports',
                    'view_as_sessions', 'view_as_session_views', 'workspace_object_cleanup_queue'])
              AND to_regclass(format('public.%I', class.table_name)) IS NOT NULL LOOP
    v_filter := CASE WHEN r.clear_predicate IS NULL THEN '' ELSE format(' AND NOT coalesce((%s), false)', r.clear_predicate) END;
    EXECUTE format('INSERT INTO pg_temp.wcr_kept SELECT to_jsonb(t)::text FROM public.%I t WHERE t.workspace_id = $1%s',
                   r.table_name, v_filter) USING p_workspace;
  END LOOP;
  DELETE FROM pg_temp.wcr_keys k WHERE EXISTS (SELECT 1 FROM pg_temp.wcr_kept kept WHERE strpos(kept.blob, k.object_key) > 0);
  SELECT count(*) INTO v_keys FROM pg_temp.wcr_keys;
  SELECT count(*) INTO v_ledger FROM workspace_stored_objects ledger
   WHERE ledger.workspace_id = p_workspace AND ledger.object_key IN (SELECT object_key FROM pg_temp.wcr_keys);
  UPDATE pg_temp.wcr_plan SET row_count = v_ledger WHERE disposition = 'files';

  IF p_dry_run THEN
    RETURN QUERY
      SELECT plan.table_name, plan.disposition, plan.row_count, NULL::uuid FROM pg_temp.wcr_plan plan
      UNION ALL SELECT 'object storage keys', 'files', v_keys, NULL::uuid
      ORDER BY 1;
    RETURN;
  END IF;

  -- Children before parents. A table is next when no table still to clear references it; when only cycles
  -- remain, edges that cascade or set null may be crossed (the database applies them), restricting ones never.
  INSERT INTO pg_temp.wcr_edges (child, parent, hard)
  SELECT child.relname, parent.relname, bool_or(constraint_row.confdeltype IN ('a', 'r'))
    FROM pg_constraint constraint_row
    JOIN pg_class child ON child.oid = constraint_row.conrelid AND child.relnamespace = 'public'::regnamespace
    JOIN pg_class parent ON parent.oid = constraint_row.confrelid AND parent.relnamespace = 'public'::regnamespace
    JOIN pg_temp.wcr_plan child_plan ON child_plan.table_name = child.relname
    JOIN pg_temp.wcr_plan parent_plan ON parent_plan.table_name = parent.relname
   WHERE constraint_row.contype = 'f' AND constraint_row.conrelid <> constraint_row.confrelid
   GROUP BY child.relname, parent.relname;
  LOOP
    SELECT plan.table_name INTO v_next FROM pg_temp.wcr_plan plan
     WHERE plan.ord IS NULL AND NOT EXISTS (
       SELECT 1 FROM pg_temp.wcr_edges edge JOIN pg_temp.wcr_plan child_plan ON child_plan.table_name = edge.child
        WHERE edge.parent = plan.table_name AND child_plan.ord IS NULL)
     ORDER BY plan.table_name LIMIT 1;
    IF v_next IS NULL THEN
      SELECT plan.table_name INTO v_next FROM pg_temp.wcr_plan plan
       WHERE plan.ord IS NULL AND NOT EXISTS (
         SELECT 1 FROM pg_temp.wcr_edges edge JOIN pg_temp.wcr_plan child_plan ON child_plan.table_name = edge.child
          WHERE edge.parent = plan.table_name AND edge.hard AND child_plan.ord IS NULL)
       ORDER BY plan.table_name LIMIT 1;
    END IF;
    EXIT WHEN v_next IS NULL;
    v_ord := v_ord + 1;
    UPDATE pg_temp.wcr_plan SET ord = v_ord WHERE table_name = v_next;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_temp.wcr_plan WHERE ord IS NULL) THEN
    RAISE EXCEPTION 'Restricting foreign keys form a cycle: %',
      (SELECT string_agg(plan.table_name, ', ') FROM pg_temp.wcr_plan plan WHERE plan.ord IS NULL) USING ERRCODE = '55000';
  END IF;

  FOR v_trigger IN
    SELECT trigger_row.tgrelid::regclass::text AS relation, trigger_row.tgname AS name
      FROM pg_trigger trigger_row
      JOIN pg_temp.wcr_plan plan ON trigger_row.tgrelid = to_regclass(format('public.%I', plan.table_name))
     WHERE plan.disposition IN ('clear', 'clear_linked') AND NOT trigger_row.tgisinternal AND trigger_row.tgenabled = 'O'
       AND (trigger_row.tgtype & 1) <> 0 AND (trigger_row.tgtype & 2) <> 0 AND (trigger_row.tgtype & 8) <> 0
     ORDER BY 1, 2 LOOP
    EXECUTE format('ALTER TABLE %s DISABLE TRIGGER %I', v_trigger.relation, v_trigger.name);
    v_suspended := v_suspended || format('ALTER TABLE %s ENABLE TRIGGER %I', v_trigger.relation, v_trigger.name);
  END LOOP;

  FOR r IN SELECT * FROM pg_temp.wcr_plan ORDER BY ord LOOP
    v_deleted := 0;
    IF r.disposition = 'files' THEN
      EXECUTE format('DELETE FROM public.%I t WHERE t.workspace_id = $1 AND t.object_key IN (SELECT object_key FROM pg_temp.wcr_keys)',
                     r.table_name) USING p_workspace;
      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    ELSE
      v_filter := CASE WHEN r.predicate IS NULL THEN '' ELSE format(' AND (%s)', r.predicate) END;
      FOR s IN
        SELECT constraint_row.conkey, constraint_row.confkey, constraint_row.conrelid
          FROM pg_constraint constraint_row
         WHERE constraint_row.contype = 'f' AND constraint_row.confdeltype = 'r'
           AND constraint_row.conrelid = constraint_row.confrelid
           AND constraint_row.conrelid = to_regclass(format('public.%I', r.table_name)) LOOP
        SELECT string_agg(format('c.%I = t.%I', child_column.attname, parent_column.attname), ' AND ') INTO v_join
          FROM unnest(s.conkey, s.confkey) AS key_pair(child_number, parent_number)
          JOIN pg_attribute child_column ON child_column.attrelid = s.conrelid AND child_column.attnum = key_pair.child_number
          JOIN pg_attribute parent_column ON parent_column.attrelid = s.conrelid AND parent_column.attnum = key_pair.parent_number;
        LOOP
          EXECUTE format('DELETE FROM public.%1$I t WHERE t.workspace_id = $1%2$s
                           AND NOT EXISTS (SELECT 1 FROM public.%1$I c WHERE %3$s AND c.ctid <> t.ctid)',
                         r.table_name, v_filter, v_join) USING p_workspace;
          GET DIAGNOSTICS v_count = ROW_COUNT;
          v_deleted := v_deleted + v_count;
          EXIT WHEN v_count = 0;
        END LOOP;
      END LOOP;
      EXECUTE format('DELETE FROM public.%I t WHERE t.workspace_id = $1%s', r.table_name, v_filter) USING p_workspace;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      v_deleted := v_deleted + v_count;
    END IF;
    UPDATE pg_temp.wcr_plan SET row_count = v_deleted WHERE table_name = r.table_name;
    v_total := v_total + v_deleted;
    IF v_deleted > 0 THEN v_counts := v_counts || jsonb_build_object(r.table_name, v_deleted); END IF;
  END LOOP;

  FOREACH v_item IN ARRAY v_suspended LOOP
    EXECUTE v_item;
  END LOOP;

  INSERT INTO workspace_object_cleanup_queue (workspace_id, object_key, clear_run_id)
  SELECT p_workspace, k.object_key, v_run FROM pg_temp.wcr_keys k
  ON CONFLICT (workspace_id, object_key) DO UPDATE SET clear_run_id = excluded.clear_run_id, status = 'pending',
    attempts = 0, last_error = NULL, created_at = now(), completed_at = NULL;

  INSERT INTO audit_events (workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id)
  VALUES (p_workspace, v_actor, 'internal', 'workspace.records_cleared', 'workspace', p_workspace, NULL,
          jsonb_build_object('runId', v_run, 'slug', v_slug, 'operatorUserId', v_actor, 'rowsDeleted', v_total,
                             'tables', v_counts, 'objectKeysQueued', v_keys, 'objectKeysOutsideWorkspace', v_outside),
          v_run);

  RETURN QUERY
    SELECT plan.table_name, plan.disposition, plan.row_count, v_run FROM pg_temp.wcr_plan plan
    UNION ALL SELECT 'object storage keys', 'files', v_keys, v_run
    ORDER BY 1;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION workspace_clear_records(uuid, text, boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION workspace_object_cleanup_workspaces() FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT SELECT, UPDATE ON workspace_object_cleanup_queue TO wodana_app;
    GRANT EXECUTE ON FUNCTION workspace_clear_records(uuid, text, boolean) TO wodana_app;
    GRANT EXECUTE ON FUNCTION workspace_object_cleanup_workspaces() TO wodana_app;
  END IF;
END $$;
