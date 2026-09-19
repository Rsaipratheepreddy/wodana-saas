-- A rollback request must revoke public host resolution before ingress cleanup
-- has finished, even if the previous DNS/certificate checks are still fresh.
CREATE OR REPLACE FUNCTION wodana_public_tenant_host(candidate varchar)
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
    AND domain.routing_status = 'active' AND domain.rollback_status = 'none'
    AND workspace.status = 'active';
$$;
