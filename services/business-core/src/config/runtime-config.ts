export function validateRuntimeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv = String(config.NODE_ENV ?? "development");
  const authMode = String(config.AUTH_MODE ?? "development");

  const sessionExemptions = String(config.AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (sessionExemptions.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("AUTH_DEVICE_LIMIT_EXEMPT_USER_IDS must contain explicit user UUIDs separated by commas");
  }

  if (!config.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  if (!(["development", "local", "password", "oidc"] as const).includes(
    authMode as "development" | "local" | "password" | "oidc",
  )) {
    throw new Error("AUTH_MODE must be development, local, password, or oidc");
  }
  if (nodeEnv === "production" && !["password", "oidc"].includes(authMode)) {
    throw new Error("Production requires AUTH_MODE=password or AUTH_MODE=oidc");
  }
  if (authMode === "oidc") {
    for (const key of ["OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URI"] as const) {
      if (!config[key]) throw new Error(`${key} is required when AUTH_MODE=oidc`);
    }
  }
  if (["local", "password"].includes(authMode) && String(config.LOCAL_AUTH_JWT_SECRET ?? "").length < 32) {
    throw new Error("LOCAL_AUTH_JWT_SECRET must contain at least 32 characters for password authentication");
  }
  if (nodeEnv === "production" && authMode === "password") {
    if (!String(config.LOCAL_AUTH_ISSUER ?? "").startsWith("https://")) {
      throw new Error("Production password authentication requires an HTTPS LOCAL_AUTH_ISSUER");
    }
    if (!String(config.LOCAL_AUTH_AUDIENCE ?? "").trim()) {
      throw new Error("Production password authentication requires LOCAL_AUTH_AUDIENCE");
    }
  }
  if (nodeEnv === "production") {
    if (!String(config.WODANA_RELEASE_ID ?? "").trim()) {
      throw new Error("Production requires WODANA_RELEASE_ID");
    }
    if (!String(config.INTELLIGENCE_API_URL ?? "").trim()) {
      throw new Error("Production requires INTELLIGENCE_API_URL");
    }
    for (const flag of ["PORTAL_DEMO_OTP", "EXPOSE_DEMO_AUTH_TOKENS"] as const) {
      if (String(config[flag] ?? "false") === "true") {
        throw new Error(`${flag} cannot be enabled in production`);
      }
    }
  }
  if (nodeEnv === "production" && String(config.DEMO_TENANT_ENABLED ?? "false") === "true") {
    throw new Error("DEMO_TENANT_ENABLED cannot be enabled in production");
  }
  if (
    nodeEnv === "production"
    && String(config.BUSINESS_CORE_INTERNAL_TOKEN ?? "").length < 32
  ) {
    throw new Error("Production requires BUSINESS_CORE_INTERNAL_TOKEN with at least 32 characters");
  }

  const mailgunApiKey = String(config.MAILGUN_API_KEY ?? "").trim();
  const mailgunDomain = String(config.MAILGUN_DOMAIN ?? "").trim();
  if (Boolean(mailgunApiKey) !== Boolean(mailgunDomain)) {
    throw new Error("MAILGUN_API_KEY and MAILGUN_DOMAIN must be configured together");
  }
  if (mailgunApiKey && mailgunDomain) {
    const baseUrl = String(config.MAILGUN_BASE_URL ?? "https://api.mailgun.net");
    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new Error("MAILGUN_BASE_URL must be a valid URL");
    }
    if (nodeEnv === "production" && parsedBaseUrl.protocol !== "https:") {
      throw new Error("Production requires an HTTPS MAILGUN_BASE_URL");
    }
    if (/\r|\n/.test(String(config.MAILGUN_FROM ?? ""))) {
      throw new Error("MAILGUN_FROM cannot contain line breaks");
    }
  }
  return config;
}
