import type { QueryResult, QueryResultRow } from "pg";
import { readableOnWhite } from "../email/readable-colour";
import { defaultBrand } from "./commercial.domain";
import type { PortalBrand } from "./commercial.types";

/** Any query runner: a pooled client in a transaction or the database service. */
type Db = { query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> };

/**
 * The brand issued quotes, the gallery and vendor pages carry. Name, logo and colours always come from
 * the tenant branding record (the same record as sign-in, the app, email and the client portal); the
 * welcome text and support phone are the client portal's own settings.
 */
export async function effectivePortalBrand(db: Db, workspaceId: string): Promise<PortalBrand> {
  const tenant = await db.query<{ name: string; slug: string; logoUrl: string | null; logoAssetId: string | null; primaryColor: string | null; secondaryColor: string | null }>(
    `SELECT branding.display_name AS name, branding.login_slug AS slug, branding.logo_url AS "logoUrl",
            branding.logo_asset_id AS "logoAssetId", branding.primary_color AS "primaryColor",
            branding.secondary_color AS "secondaryColor"
     FROM tenant_login_branding branding WHERE branding.workspace_id = $1`,
    [workspaceId],
  );
  const portal = await db.query<{ welcomeTitle: string; welcomeText: string; supportPhone: string }>(
    `SELECT welcome_title AS "welcomeTitle", welcome_text AS "welcomeText", support_phone AS "supportPhone" FROM client_portal_settings WHERE workspace_id = $1`,
    [workspaceId],
  );
  const row = tenant.rows[0];
  const stored = portal.rows[0];
  const fallback = defaultBrand(row?.name ?? "");
  const logo = row?.logoAssetId
    ? `/api/auth/tenant-logo/${encodeURIComponent(row.slug)}?v=${row.logoAssetId}`
    : row?.logoUrl ?? "";
  // Quote headers and buttons put white text on these colours.
  const primary = readableOnWhite(row?.primaryColor, fallback.primaryColor);
  return {
    ...fallback,
    welcomeTitle: stored?.welcomeTitle || fallback.welcomeTitle,
    welcomeText: stored?.welcomeText || fallback.welcomeText,
    supportPhone: stored?.supportPhone || fallback.supportPhone,
    name: row?.name ?? fallback.name,
    logo,
    primaryColor: primary,
    accentColor: readableOnWhite(row?.secondaryColor, primary),
  };
}
