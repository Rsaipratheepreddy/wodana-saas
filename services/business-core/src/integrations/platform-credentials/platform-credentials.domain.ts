import { BadRequestException } from "@nestjs/common";

/**
 * Wodana's own app credentials for the providers firms connect to, set from Wodana Control. One row per
 * provider (the vendor whose console issues the app), plus "platform" for the public address the
 * callback and webhook URLs are built from. Firms' own tokens are elsewhere (integration_connections).
 */
export const PLATFORM_CREDENTIAL_PROVIDERS = ["platform", "meta", "intuit", "zoho", "google"] as const;
export type PlatformCredentialProvider = typeof PLATFORM_CREDENTIAL_PROVIDERS[number];
export type TestableProvider = Exclude<PlatformCredentialProvider, "platform">;

export const ZOHO_DATA_CENTERS = ["us", "in", "eu", "au", "ca", "jp", "sa"] as const;
export const INTUIT_ENVIRONMENTS = ["sandbox", "production"] as const;

export type ValueField = "clientId" | "configId" | "graphVersion" | "environment" | "dataCenter" | "publicApiBase";
export type SecretField = "clientSecret" | "webhookSecret";
type Field = ValueField | SecretField;

type ProviderShape = { values: ValueField[]; secrets: SecretField[]; required: Field[] };

/** Which fields each provider has, and which it needs before firms can connect. */
export const PROVIDER_FIELDS: Record<PlatformCredentialProvider, ProviderShape> = {
  platform: { values: ["publicApiBase"], secrets: [], required: ["publicApiBase"] },
  // The verify token is required: without the webhook, replies and delivery receipts never arrive.
  meta: { values: ["clientId", "configId", "graphVersion"], secrets: ["clientSecret", "webhookSecret"],
    required: ["clientId", "clientSecret", "configId", "webhookSecret"] },
  // QuickBooks webhooks are optional (balances are also refreshed on read).
  intuit: { values: ["clientId", "environment"], secrets: ["clientSecret", "webhookSecret"], required: ["clientId", "clientSecret", "environment"] },
  zoho: { values: ["clientId", "dataCenter"], secrets: ["clientSecret"], required: ["clientId", "clientSecret", "dataCenter"] },
  google: { values: ["clientId"], secrets: ["clientSecret"], required: ["clientId", "clientSecret"] },
};

export const VALUE_COLUMNS: Record<ValueField, string> = {
  clientId: "client_id",
  configId: "config_id",
  graphVersion: "graph_version",
  environment: "environment",
  dataCenter: "data_center",
  publicApiBase: "public_api_base",
};
export const SECRET_COLUMNS: Record<SecretField, { sealed: string; last4: string }> = {
  clientSecret: { sealed: "client_secret_sealed", last4: "client_secret_last4" },
  webhookSecret: { sealed: "webhook_secret_sealed", last4: "webhook_secret_last4" },
};

/** Why a Test failed. The intelligence service reports one of these; the portal words them. */
export const TEST_REASONS = [
  "not_set", "rejected", "unreachable", "unexpected_response", "app_mismatch", "graph_version", "invalid_format", "store_unavailable",
] as const;
export type TestReason = typeof TEST_REASONS[number];

/** The row as the app role may read it: never the sealed secrets. */
export type CredentialRow = {
  provider: PlatformCredentialProvider;
  clientId: string | null;
  clientSecretLast4: string | null;
  webhookSecretLast4: string | null;
  configId: string | null;
  graphVersion: string | null;
  environment: string | null;
  dataCenter: string | null;
  publicApiBase: string | null;
  testStatus: "untested" | "passed" | "failed";
  testReason: string | null;
  testedAt: Date | null;
  lastRequestKey: string | null;
  version: number;
  updatedAt: Date;
};

export const ROW_COLUMNS = `provider, client_id AS "clientId", client_secret_last4 AS "clientSecretLast4",
  webhook_secret_last4 AS "webhookSecretLast4", config_id AS "configId", graph_version AS "graphVersion",
  environment, data_center AS "dataCenter", public_api_base AS "publicApiBase", test_status AS "testStatus",
  test_reason AS "testReason", tested_at AS "testedAt", last_request_key AS "lastRequestKey", version,
  updated_at AS "updatedAt"`;

export type CredentialStatus = "not_set" | "set" | "tested_ok" | "test_failed";
export type CredentialUrl = { id: "callback" | "webhook"; url: string };

export type CredentialView = {
  provider: PlatformCredentialProvider;
  status: CredentialStatus;
  values: Partial<Record<ValueField, string | null>>;
  secrets: Partial<Record<SecretField, { set: boolean; last4: string | null }>>;
  required: Field[];
  test: { reason: string | null; testedAt: string | null } | null;
  urls: CredentialUrl[];
  version: number;
  updatedAt: string;
};

export function isPlatformCredentialProvider(value: string): value is PlatformCredentialProvider {
  return (PLATFORM_CREDENTIAL_PROVIDERS as readonly string[]).includes(value);
}

function secretSet(row: CredentialRow, field: SecretField) {
  return (field === "clientSecret" ? row.clientSecretLast4 : row.webhookSecretLast4) !== null;
}

/** Every required field is saved here (env values on the servers don't count). */
export function isComplete(row: CredentialRow) {
  return PROVIDER_FIELDS[row.provider].required.every((field) =>
    field === "clientSecret" || field === "webhookSecret" ? secretSet(row, field) : Boolean(row[field]));
}

/**
 * The latest Test for the current version wins (a change resets it); otherwise Set when every required
 * field is saved, else Not set.
 */
export function credentialStatus(row: CredentialRow): CredentialStatus {
  if (row.testStatus === "passed") return "tested_ok";
  if (row.testStatus === "failed") return "test_failed";
  return isComplete(row) ? "set" : "not_set";
}

const API = "/api/v1/integrations";

/**
 * The URLs to register in each provider's console. One callback per provider serves every firm: the
 * firm and connection travel in the OAuth `state`, never in the URL. Kept in step with the intelligence
 * service's routes (and its resolver, which builds the same callbacks).
 */
export function providerUrls(provider: PlatformCredentialProvider, base: string | null): CredentialUrl[] {
  if (!base) return [];
  switch (provider) {
    case "meta": return [{ id: "webhook", url: `${base}${API}/providers/webhooks/whatsapp` }];
    case "intuit": return [
      { id: "callback", url: `${base}${API}/providers/quickbooks/oauth/callback` },
      { id: "webhook", url: `${base}${API}/providers/webhooks/quickbooks` },
    ];
    case "zoho": return [{ id: "callback", url: `${base}${API}/providers/zoho_books/oauth/callback` }];
    case "google": return [{ id: "callback", url: `${base}${API}/google/oauth/callback` }];
    default: return [];
  }
}

export function credentialView(row: CredentialRow, publicApiBase: string | null): CredentialView {
  const shape = PROVIDER_FIELDS[row.provider];
  return {
    provider: row.provider,
    status: credentialStatus(row),
    values: Object.fromEntries(shape.values.map((field) => [field, row[field]])),
    secrets: Object.fromEntries(shape.secrets.map((field) => {
      const last4 = field === "clientSecret" ? row.clientSecretLast4 : row.webhookSecretLast4;
      return [field, { set: last4 !== null, last4 }];
    })),
    required: shape.required,
    test: row.testStatus === "untested" ? null : { reason: row.testReason, testedAt: row.testedAt ? new Date(row.testedAt).toISOString() : null },
    urls: providerUrls(row.provider, publicApiBase),
    version: row.version,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The public origin of the integration API: HTTPS (plain HTTP only on this machine), no path. */
export function normalizePublicApiBase(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw invalid("Enter the public address as https://host."); }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!secure || url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== "/")) {
    throw invalid("Enter the public address as https://host, without a path.");
  }
  return url.origin;
}

const VALUE_FORMATS: Record<PlatformCredentialProvider, Partial<Record<ValueField, [RegExp, string]>>> = {
  platform: {},
  meta: {
    clientId: [/^\d{5,20}$/, "Enter the Meta app ID (digits only)."],
    configId: [/^\d{5,40}$/, "Enter the Embedded Signup configuration ID (digits only)."],
    graphVersion: [/^v\d{1,2}\.\d$/, "Enter the Graph API version, for example v23.0."],
  },
  intuit: {
    clientId: [/^[A-Za-z0-9]{10,100}$/, "Enter the Intuit client ID (letters and digits)."],
    environment: [/^(sandbox|production)$/, "Choose sandbox or production."],
  },
  zoho: {
    clientId: [/^[A-Za-z0-9._-]{8,120}$/, "Enter the Zoho client ID."],
    dataCenter: [new RegExp(`^(${ZOHO_DATA_CENTERS.join("|")})$`), "Choose the Zoho data center."],
  },
  google: {
    clientId: [/^[0-9]{3,40}-[a-z0-9]{8,64}\.apps\.googleusercontent\.com$/, "Enter the Google client ID ending in .apps.googleusercontent.com."],
  },
};

/** Secrets are provider-issued (or, for verify tokens, long random strings): printable, no spaces. */
const SECRET_FORMAT = /^[\x21-\x7e]{16,256}$/;

export type CredentialInput = Partial<Record<ValueField, string | null>> & Partial<Record<SecretField, string | null>>;

/** What a save asks for, validated: values to set or clear, secrets to replace (still in the clear) or remove. */
export type CredentialPlan = {
  values: Partial<Record<ValueField, string | null>>;
  replace: Partial<Record<SecretField, string>>;
  remove: SecretField[];
};

export function planCredentialChange(provider: PlatformCredentialProvider, input: CredentialInput): CredentialPlan {
  const shape = PROVIDER_FIELDS[provider];
  const plan: CredentialPlan = { values: {}, replace: {}, remove: [] };
  for (const [key, raw] of Object.entries(input) as Array<[Field, string | null | undefined]>) {
    if (raw === undefined) continue;
    if (key === "clientSecret" || key === "webhookSecret") {
      if (!shape.secrets.includes(key)) throw invalid("This field doesn't apply to this provider.");
      if (raw === null) { plan.remove.push(key); continue; }
      if (!SECRET_FORMAT.test(raw)) throw invalid("Paste the full secret: at least 16 characters, no spaces.");
      plan.replace[key] = raw;
      continue;
    }
    if (!shape.values.includes(key)) throw invalid("This field doesn't apply to this provider.");
    const value = typeof raw === "string" ? raw.trim() : null;
    if (!value) { plan.values[key] = null; continue; }
    if (key === "publicApiBase") { plan.values[key] = normalizePublicApiBase(value); continue; }
    const format = VALUE_FORMATS[provider][key];
    if (format && !format[0].test(value)) throw invalid(format[1]);
    plan.values[key] = value;
  }
  return plan;
}

function invalid(message: string) {
  return new BadRequestException(message);
}
