/**
 * Canva for design boards and concepts (plan §6.25, §6.7a batch 1 PLM-049 and batch 3).
 *
 * Today: a Canva share link is attached as a link card. Its title and thumbnail come from the page's OpenGraph tags
 * (read through the SSRF-safe fetcher, the thumbnail copied into our storage); "Open in Canva" opens the link.
 *
 * Later: the Canva Connect API. Everything that needs it goes through `CanvaConnect` below, so the link-card path
 * never changes when it is configured. It will need (Settings › Integrations, per workspace):
 *   - a Canva Connect integration: client ID and client secret, and its redirect URL registered with Canva;
 *   - OAuth 2.0 authorization code with PKCE per connecting person (access + refresh tokens, stored encrypted);
 *   - scopes design:meta:read (title, thumbnail, view/edit URLs), design:content:read (exports to PDF/PNG for
 *     the portal and proposals) and asset:read; design:content:write only if we ever create designs;
 *   - Canva's review of the integration before other workspaces can connect (a public integration).
 */
export type CanvaLink = { url: string; designId: string | null };

const CANVA_HOSTS = new Set(["canva.com", "www.canva.com", "canva.link"]);

/** A Canva design or share link (https only), with its design id when the path carries one; otherwise null. */
export function canvaLink(raw: string): CanvaLink | null {
  let url: URL;
  try { url = new URL(String(raw ?? "").trim()); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !(CANVA_HOSTS.has(host) || host.endsWith(".canva.site"))) return null;
  url.hash = "";
  const designId = url.pathname.match(/^\/design\/([A-Za-z0-9_-]{6,64})(?:\/|$)/)?.[1] ?? null;
  return { url: url.toString(), designId };
}

export type CanvaDesignMeta = { title: string | null; thumbnailUrl: string | null; viewUrl: string | null; editUrl: string | null };

/** The Canva Connect API, isolated: the link-card path asks it first and falls back to OpenGraph when it can't answer. */
export interface CanvaConnect {
  readonly configured: boolean;
  /** Title, thumbnail and URLs of a design the connected person can see; null when it can't be read. */
  designMeta(workspaceId: string, userId: string, designId: string): Promise<CanvaDesignMeta | null>;
}

/** Until Canva Connect credentials exist: nothing is asked of Canva's API. */
export class CanvaConnectNotConfigured implements CanvaConnect {
  readonly configured = false;
  async designMeta() { return null; }
}

export const CANVA_CONNECT = Symbol("CANVA_CONNECT");
