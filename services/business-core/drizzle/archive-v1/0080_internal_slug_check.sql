CREATE FUNCTION wodana_internal_slug_taken(candidate varchar)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspaces WHERE slug = candidate)
      OR EXISTS (SELECT 1 FROM public.tenant_login_branding WHERE login_slug = candidate);
$$;
REVOKE ALL ON FUNCTION wodana_internal_slug_taken(varchar) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION wodana_internal_slug_taken(varchar) TO wodana_app;
  END IF;
END $$;
