ALTER TABLE tenant_login_branding
  ADD COLUMN secondary_color varchar(7),
  ADD COLUMN heading_font varchar(40),
  ADD COLUMN body_font varchar(40),
  ADD CONSTRAINT tenant_login_branding_secondary_color_check
    CHECK (secondary_color IS NULL OR secondary_color ~ '^#[0-9A-F]{6}$'),
  ADD CONSTRAINT tenant_login_branding_heading_font_check
    CHECK (heading_font IS NULL OR heading_font IN ('alta')),
  ADD CONSTRAINT tenant_login_branding_body_font_check
    CHECK (body_font IS NULL OR body_font IN ('montserrat'));
--> statement-breakpoint
DROP FUNCTION IF EXISTS wodana_public_tenant_host(varchar);
--> statement-breakpoint
CREATE FUNCTION wodana_public_tenant_host(candidate varchar)
RETURNS TABLE (
  "displayName" varchar(160),
  "loginSlug" varchar(80),
  "logoUrl" text,
  "primaryColor" varchar(7),
  "secondaryColor" varchar(7),
  "headingFont" varchar(40),
  "bodyFont" varchar(40)
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
         branding.primary_color, branding.secondary_color,
         branding.heading_font, branding.body_font
  FROM public.workspace_domains domain
  JOIN public.workspaces workspace ON workspace.id = domain.workspace_id
  JOIN public.tenant_login_branding branding ON branding.workspace_id = workspace.id
  WHERE domain.hostname = candidate AND domain.removed_at IS NULL
    AND domain.dns_status = 'verified' AND domain.dns_verified_at > now() - interval '7 days'
    AND domain.certificate_status = 'issued' AND domain.certificate_expires_at > now()
    AND domain.routing_status = 'active' AND domain.rollback_status = 'none'
    AND workspace.status = 'active';
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION wodana_public_tenant_host(varchar) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wodana_app') THEN
    GRANT EXECUTE ON FUNCTION wodana_public_tenant_host(varchar) TO wodana_app;
  END IF;
END $$;
