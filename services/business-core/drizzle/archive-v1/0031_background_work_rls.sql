-- Background work is selected through narrowly scoped SECURITY DEFINER functions.
-- Keep RLS enabled for the application role, while allowing the table owner used
-- by those functions to inspect work across tenants.
ALTER TABLE outbox_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE automation_waits NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_sla_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_sequence_enrollments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE crm_sequences NO FORCE ROW LEVEL SECURITY;
