-- The app role keeps exactly what each table's migration grants. Databases set up with default table privileges
-- (infra/postgres/001-create-app-role.sh) also handed it UPDATE and DELETE on published flow versions and recorded
-- step skips, and every right on the replay-token table that only its SECURITY DEFINER functions touch. Take those
-- back: published flow versions never change, a step skip is only revoked (three columns), and webhook tokens are
-- read and written through their functions. RLS untouched. Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    REVOKE UPDATE, DELETE ON crm_flow_versions FROM wodana_app;
    REVOKE UPDATE, DELETE ON crm_opportunity_step_skips FROM wodana_app;
    GRANT UPDATE (revoked_at, revoked_by, revoke_reason) ON crm_opportunity_step_skips TO wodana_app;
    REVOKE ALL ON inbound_webhook_tokens FROM wodana_app;
  END IF;
END $$;
