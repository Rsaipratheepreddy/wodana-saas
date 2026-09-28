import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import { readPortalSettings, type PortalSettings } from "./portal-settings";

type Db = Pick<PoolClient, "query">;

/**
 * The portal as the public sees it before signing in: the tenant's own brand (the branding record is the
 * only source: name, logo, colours, fonts), its welcome and support contacts, its region (so numbers,
 * dates, money and phone numbers follow the country) and how codes can be sent.
 */
export type PortalSite = {
  slug: string;
  brand: { name: string; logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; headingFont: string | null; bodyFont: string | null };
  welcomeTitle: string;
  welcomeText: string;
  support: { phone: string; email: string; whatsapp: string };
  region: { locale: string; currency: string; timeZone: string; country: string | null };
  signIn: { channels: Array<"whatsapp" | "email">; demo: boolean };
  gallerySlug: string | null;
};

export async function readSite(db: Db, workspaceId: string, settings: PortalSettings, demo: boolean): Promise<PortalSite> {
  const row = (await db.query<{
    name: string; loginSlug: string | null; logoUrl: string | null; logoAssetId: string | null; primaryColor: string | null; secondaryColor: string | null;
    headingFont: string | null; bodyFont: string | null; locale: string; currency: string; timeZone: string; whatsapp: boolean;
  }>(
    `SELECT coalesce(branding.display_name, workspace.name) AS name, branding.login_slug AS "loginSlug", branding.logo_url AS "logoUrl",
            branding.logo_asset_id AS "logoAssetId", branding.primary_color AS "primaryColor", branding.secondary_color AS "secondaryColor",
            branding.heading_font AS "headingFont", branding.body_font AS "bodyFont", workspace.default_locale AS locale,
            trim(workspace.default_currency) AS currency, workspace.default_timezone AS "timeZone",
            EXISTS (SELECT 1 FROM integration_connections connection WHERE connection.workspace_id = workspace.id AND connection.provider = 'whatsapp'
                     AND connection.status = 'connected') AS whatsapp
       FROM workspaces workspace LEFT JOIN tenant_login_branding branding ON branding.workspace_id = workspace.id
      WHERE workspace.id = $1`, [workspaceId])).rows[0];
  const gallery = (await db.query<{ slug: string | null }>(`SELECT published_gallery_slug($1) AS slug`, [workspaceId]).catch(() => ({ rows: [{ slug: null }] }))).rows[0];
  const logoUrl = row.logoAssetId && row.loginSlug
    ? `/api/auth/tenant-logo/${encodeURIComponent(row.loginSlug)}?v=${row.logoAssetId}`
    : row.logoUrl && /^https:\/\//.test(row.logoUrl) ? row.logoUrl : null;
  let country: string | null = null;
  try { country = new Intl.Locale(row.locale).region ?? null; } catch { country = null; }
  // WhatsApp needs the tenant's connection; without it (or in demo mode) codes go by email.
  const channels: Array<"whatsapp" | "email"> = row.whatsapp || demo ? ["whatsapp", "email"] : ["email"];
  return {
    slug: settings.slug,
    brand: { name: row.name, logoUrl, primaryColor: row.primaryColor, secondaryColor: row.secondaryColor, headingFont: row.headingFont, bodyFont: row.bodyFont },
    welcomeTitle: settings.welcomeTitle, welcomeText: settings.welcomeText, support: settings.support,
    region: { locale: row.locale, currency: row.currency, timeZone: row.timeZone, country },
    signIn: { channels, demo }, gallerySlug: gallery?.slug ?? null,
  };
}

/** Which enabled portal a link, the tenant's own domain or its sign-in subdomain opens (no tenant known yet). */
export async function findSite(db: { query<R extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> }, by: { slug?: string; host?: string; login?: string }) {
  const query = by.slug !== undefined ? ["client_portal_site", by.slug] : by.host !== undefined ? ["client_portal_site_for_host", by.host] : ["client_portal_site_for_login", by.login ?? ""];
  if (!/^[a-z0-9.-]{1,253}$/i.test(query[1])) return null;
  return (await db.query<{ workspaceId: string; slug: string }>(`SELECT * FROM ${query[0]}($1::varchar)`, [query[1].toLowerCase()])).rows[0] ?? null;
}

/** Where a client opens the portal: the tenant's own domain when it has one, else the portal link. */
export async function portalLink(db: Db, workspaceId: string, slug: string, path = "") {
  const host = (await db.query<{ host: string | null }>(`SELECT client_portal_custom_host($1) AS host`, [workspaceId])).rows[0]?.host;
  return host ? `https://${host}/portal${path}` : `/portal/${slug}${path}`;
}

/** The web app's public address (the first WEB_ORIGIN), where a portal link without a tenant domain lives. */
export function webOrigin(config: { get(key: string): unknown }) {
  const configured = config.get("WEB_ORIGIN");
  return (typeof configured === "string" && configured.trim() ? configured : "http://localhost:3000").split(",")[0].trim();
}

/** The portal's full address, as staff copy it and as emails carry it. */
export async function portalUrl(db: Db, config: { get(key: string): unknown }, workspaceId: string, slug: string, path = "") {
  return new URL(await portalLink(db, workspaceId, slug, path), webOrigin(config)).toString();
}
