import { tKey } from "@/lib/i18n/keys";
import { ConsoleRequestError } from "./console";

/** Wodana's own app per provider (the vendor whose console issues it), and "platform" for the public address. */
export type PlatformProvider = "platform" | "meta" | "intuit" | "zoho" | "google";
export type PlatformValueField = "clientId" | "configId" | "graphVersion" | "environment" | "dataCenter" | "publicApiBase";
export type PlatformSecretField = "clientSecret" | "webhookSecret";
export type PlatformConnectionStatus = "not_set" | "set" | "tested_ok" | "test_failed";

export type PlatformConnection = {
  provider: PlatformProvider;
  status: PlatformConnectionStatus;
  values: Partial<Record<PlatformValueField, string | null>>;
  secrets: Partial<Record<PlatformSecretField, { set: boolean; last4: string | null }>>;
  required: Array<PlatformValueField | PlatformSecretField>;
  test: { reason: string | null; testedAt: string | null } | null;
  urls: Array<{ id: "callback" | "webhook"; url: string }>;
  version: number;
  updatedAt: string;
};

export type PlatformConnections = { providers: PlatformConnection[] };
export type PlatformTestResult = PlatformConnections & { result: { provider: PlatformProvider; ok: boolean; reason: string | null } };

/** A save: a field left out keeps its value; null clears it. A secret is replaced, or removed with null. */
export type PlatformConnectionSave = { expectedVersion: number } & Partial<Record<PlatformValueField | PlatformSecretField, string | null>>;

export const ZOHO_DATA_CENTERS = [
  { id: "us", label: tKey("United States / Global (.com)") },
  { id: "in", label: tKey("India (.in)") },
  { id: "eu", label: tKey("Europe (.eu)") },
  { id: "au", label: tKey("Australia") },
  { id: "ca", label: tKey("Canada") },
  { id: "jp", label: tKey("Japan") },
  { id: "sa", label: tKey("Saudi Arabia") },
] as const;

export const TEST_REASON_LABELS: Record<string, ReturnType<typeof tKey>> = {
  not_set: tKey("Enter the required credentials first."),
  rejected: tKey("The provider rejected the client ID or secret."),
  unreachable: tKey("The provider could not be reached. Try again."),
  unexpected_response: tKey("The provider sent an unexpected answer."),
  app_mismatch: tKey("The secret belongs to a different app."),
  graph_version: tKey("Meta doesn't accept this Graph API version."),
  invalid_format: tKey("A saved value isn't in the provider's format."),
  store_unavailable: tKey("The saved credentials could not be read."),
};

/** Business Core's words for a refused save or check, so they show in the operator's language. */
export const SERVER_MESSAGES = [
  tKey("Enter the public address as https://host."),
  tKey("Enter the public address as https://host, without a path."),
  tKey("Enter the Meta app ID (digits only)."),
  tKey("Enter the Embedded Signup configuration ID (digits only)."),
  tKey("Enter the Graph API version, for example v23.0."),
  tKey("Enter the Intuit client ID (letters and digits)."),
  tKey("Choose sandbox or production."),
  tKey("Enter the Zoho client ID."),
  tKey("Choose the Zoho data center."),
  tKey("Enter the Google client ID ending in .apps.googleusercontent.com."),
  tKey("Paste the full secret: at least 16 characters, no spaces."),
  tKey("This field doesn't apply to this provider."),
  tKey("These credentials changed. Reload and try again."),
  tKey("The secret could not be stored. Try again."),
  tKey("The integration service is unavailable. Try again."),
  tKey("The check could not run. Try again."),
] as const;

async function request<T>(path: string, init?: RequestInit & { idempotencyKey?: string }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  if (init?.idempotencyKey) headers.set("idempotency-key", init.idempotencyKey);
  const response = await fetch(path, { ...init, headers, cache: "no-store" });
  const data = await response.json().catch(() => null) as (T & { message?: string }) | null;
  if (!response.ok) throw new ConsoleRequestError(typeof data?.message === "string" ? data.message : "", response.status);
  return data as T;
}

const base = "/api/internal/platform-integrations";

/** Wodana Control → Platform connections, through the same-origin internal routes. */
export const platformConnectionsApi = {
  list: () => request<PlatformConnections>(base),
  save: (provider: PlatformProvider, body: PlatformConnectionSave, idempotencyKey: string) =>
    request<PlatformConnections>(`${base}/${provider}`, { method: "PUT", body: JSON.stringify(body), idempotencyKey }),
  test: (provider: Exclude<PlatformProvider, "platform">) =>
    request<PlatformTestResult>(`${base}/${provider}/test`, { method: "POST" }),
};
