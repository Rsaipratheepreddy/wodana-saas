import { DeliveryAllowlist } from "../notifications/delivery-allowlist";

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
  if (["local", "password"].includes(authMode)) {
    const mfaKey = String(config.MFA_ENCRYPTION_KEY ?? "").trim();
    const decodedMfaKey = /^[0-9a-f]{64}$/i.test(mfaKey)
      ? Buffer.from(mfaKey, "hex")
      : Buffer.from(mfaKey, "base64url");
    if (decodedMfaKey.length !== 32) {
      throw new Error("Password authentication requires a 32-byte MFA_ENCRYPTION_KEY");
    }
  }
  const mfaKeyVersion = Number(config.MFA_ENCRYPTION_KEY_VERSION ?? 1);
  if (!Number.isInteger(mfaKeyVersion) || mfaKeyVersion < 1) {
    throw new Error("MFA_ENCRYPTION_KEY_VERSION must be a positive integer");
  }
  const mfaStepUpMinutes = Number(config.MFA_STEP_UP_MINUTES ?? 10);
  if (!Number.isFinite(mfaStepUpMinutes) || mfaStepUpMinutes < 1 || mfaStepUpMinutes > 60) {
    throw new Error("MFA_STEP_UP_MINUTES must be between 1 and 60");
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

  const inboundDomain = String(config.INBOUND_EMAIL_DOMAIN ?? "").trim();
  if (inboundDomain && !/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(inboundDomain.replace(/^@/, ""))) {
    throw new Error("INBOUND_EMAIL_DOMAIN must be a domain name, e.g. in.example.com");
  }

  const sesFrom = String(config.SES_FROM ?? "");
  if (/\r|\n/.test(sesFrom)) {
    throw new Error("SES_FROM cannot contain line breaks");
  }
  const emailProvider = String(config.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (emailProvider && !["mailgun", "ses"].includes(emailProvider)) {
    throw new Error("EMAIL_PROVIDER must be mailgun or ses");
  }
  if (emailProvider === "ses" && !sesFrom.trim()) {
    throw new Error("EMAIL_PROVIDER=ses requires SES_FROM");
  }
  // The outbound email limit (every send of this process takes a slot) and the reminder sweep's email cap.
  for (const key of ["EMAIL_SEND_PER_SECOND", "EMAIL_SEND_PER_MINUTE", "REMINDERS_SWEEP_EMAIL_CAP"] as const) {
    const text = String(config[key] ?? "").trim();
    if (text && !(/^\d+$/.test(text) && Number(text) > 0)) {
      throw new Error(`${key} must be a positive whole number`);
    }
  }

  // The delivery guard is for local and UAT only: in production it would silently drop real messages.
  const allowlist = DeliveryAllowlist.parse(String(config.DELIVERY_ALLOWLIST ?? ""));
  if (allowlist.enabled && String(config.ENVIRONMENT ?? "").trim().toLowerCase() === "production") {
    throw new Error("DELIVERY_ALLOWLIST is for local and UAT environments; remove it in production (ENVIRONMENT=production)");
  }
  return config;
}
