-- Public sign-in must resolve an active custom host before there is a tenant
-- session. Keep the RLS-protected domain table private and expose only the
-- approved login identity through this exact-host lookup.
CREATE FUNCTION wodana_public_tenant_host(candidate varchar)
RETURNS TABLE (
  "displayName" varchar(160),
  "loginSlug" varchar(80),
  "logoUrl" text,
  "primaryColor" varchar(7)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT branding.display_name, branding.login_slug,
         CASE WHEN branding.logo_asset_id IS NOT NULL
              THEN '/api/auth/tenant-logo/' || branding.login_slug || '?v=' || branding.logo_asset_id::text
              ELSE branding.logo_url END,
         branding.primary_color
  FROM public.workspace_domains domain
  JOIN public.workspaces workspace ON workspace.id = domain.workspace_id
  JOIN public.tenant_login_branding branding ON branding.workspace_id = workspace.id
  WHERE domain.hostname = candidate AND domain.removed_at IS NULL
    AND domain.dns_status = 'verified' AND domain.dns_verified_at > now() - interval '7 days'
    AND domain.certificate_status = 'issued' AND domain.certificate_expires_at > now()
    AND domain.routing_status = 'active' AND workspace.status = 'active';
$$;
REVOKE ALL ON FUNCTION wodana_public_tenant_host(varchar) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION wodana_public_tenant_host(varchar) TO wodana_app;
  END IF;
END $$;
