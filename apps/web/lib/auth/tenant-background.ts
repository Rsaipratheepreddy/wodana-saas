const LOGIN_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /[?&]v=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:&|$)/i;

/**
 * The tenant's own sign-in background as this app's same-origin address (versioned by its asset, so a new image is
 * never served from cache), or null when the tenant has none and the default image shows. Built from the login slug
 * and the asset id only, so it is safe inside a CSS url().
 */
export function tenantBackgroundUrl(loginSlug: string, backendUrl: string | null | undefined): string | null {
  if (!backendUrl || !LOGIN_SLUG.test(loginSlug)) return null;
  const version = VERSION.exec(backendUrl)?.[1];
  return `/api/auth/tenant-background/${loginSlug}${version ? `?v=${version.toLowerCase()}` : ""}`;
}
