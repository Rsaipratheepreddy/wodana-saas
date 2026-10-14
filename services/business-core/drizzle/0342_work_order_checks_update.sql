-- Factory › work order › Output › Check quality with a photo: uploadCheckPhoto (factory.service.ts) locks the check with
-- SELECT … FOR UPDATE before storing its photo, and a row lock needs UPDATE on the table. 0054 granted the app role
-- SELECT, INSERT only on work_order_checks, so the request failed with "permission denied for table work_order_checks"
-- (the check was saved, the photo wasn't). A check is still never deleted; its row changes only through the app's own
-- commands. RLS and the tenant_isolation policy from 0054 are unchanged. Idempotent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT UPDATE ON work_order_checks TO wodana_app;
  END IF;
END $$;
