import type { QueryResult, QueryResultRow } from "pg";
import { defaultBrand } from "./commercial.domain";
import type { PortalBrand } from "./commercial.types";

/** Any query runner: a pooled client in a transaction or the database service. */
type Db = { query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> };

/**
 * The client portal, issued quotes and vendor pages show the tenant brand. Name, logo and colours
 * always come from the tenant branding record (the same record as sign-in, the app and email);
 * the portal keeps only its own welcome text, support phone and layout.
 */
export async function effectivePortalBrand(db: Db, workspaceId: string, stored?: Partial<PortalBrand> | null): Promise<PortalBrand> {
  const tenant = await db.query<{ name: string; slug: string; logoUrl: string | null; logoAssetId: string | null; primaryColor: string | null; secondaryColor: string | null }>(
    `SELECT branding.display_name AS name, branding.login_slug AS slug, branding.logo_url AS "logoUrl",
            branding.logo_asset_id AS "logoAssetId", branding.primary_color AS "primaryColor",
            branding.secondary_color AS "secondaryColor"
     FROM tenant_login_branding branding WHERE branding.workspace_id = $1`,
    [workspaceId],
  );
  const row = tenant.rows[0];
  const fallback = defaultBrand(row?.name ?? stored?.name ?? "");
  const logo = row?.logoAssetId
    ? `/api/auth/tenant-logo/${encodeURIComponent(row.slug)}?v=${row.logoAssetId}`
    : row?.logoUrl ?? "";
  const primary = row?.primaryColor ?? fallback.primaryColor;
  return {
    ...fallback,
    welcomeTitle: stored?.welcomeTitle ?? fallback.welcomeTitle,
    welcomeText: stored?.welcomeText ?? fallback.welcomeText,
    supportPhone: stored?.supportPhone ?? fallback.supportPhone,
    layout: stored?.layout ?? fallback.layout,
    name: row?.name ?? fallback.name,
    logo,
    primaryColor: primary,
    accentColor: row?.secondaryColor ?? primary,
  };
}

/** What the portal stores: only its own content. Brand identity is never copied. */
export function portalOwnedBrand(brand: PortalBrand) {
  const { welcomeTitle, welcomeText, supportPhone, layout } = brand;
  return { welcomeTitle, welcomeText, supportPhone, layout };
}
