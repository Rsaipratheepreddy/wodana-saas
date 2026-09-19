const RESERVED_HOSTS = new Set(["admin", "api", "client", "integrations", "www"]);
const GENERIC_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "wodana.ai", "www.wodana.ai", "admin.wodana.ai", "api.wodana.ai", "client.wodana.ai", "integrations.wodana.ai"]);

export function hostnameFromHeader(host: string | null): string | null {
  const value = host?.trim().toLowerCase();
  if (!value || /[\s\/@?#\\,]/.test(value)) return null;
  try {
    const url = new URL(`http://${value}`);
    if (url.username || url.password || url.pathname !== "/") return null;
    return url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  } catch { return null; }
}

export function tenantSlugFromHost(host: string | null, baseDomain = "wodana.ai"): string | null {
  const hostname = hostnameFromHeader(host);
  if (!hostname) return null;
  const suffix = `.${baseDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;
  const slug = hostname.slice(0, -suffix.length);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !RESERVED_HOSTS.has(slug) ? slug : null;
}

export function classifyTenantHost(host: string | null): { kind: "generic" } | { kind: "tenant"; slug: string } | { kind: "custom"; hostname: string } | { kind: "invalid" } {
  const hostname = hostnameFromHeader(host);
  if (!hostname) return { kind: "invalid" };
  const slug = tenantSlugFromHost(host);
  if (slug) return { kind: "tenant", slug };
  if (GENERIC_HOSTS.has(hostname)) return { kind: "generic" };
  return { kind: "custom", hostname };
}
