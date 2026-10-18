import { describe, expect, it } from "vitest";
import { platformOperatorCan } from "../../auth/platform-operator-policy";
import { PLATFORM_OPERATOR_PERMISSION_KEY } from "../../auth/platform-operator-permission.guard";
import {
  credentialStatus,
  credentialView,
  normalizePublicApiBase,
  planCredentialChange,
  providerUrls,
  type CredentialRow,
} from "./platform-credentials.domain";
import { OperatorPlatformIntegrationsController } from "./platform-credentials.controller";

const row = (overrides: Partial<CredentialRow> = {}): CredentialRow => ({
  provider: "meta", clientId: null, clientSecretLast4: null, webhookSecretLast4: null, configId: null, graphVersion: null,
  environment: null, dataCenter: null, publicApiBase: null, testStatus: "untested", testReason: null, testedAt: null,
  lastRequestKey: null, version: 1, updatedAt: new Date("2026-09-29T08:00:00Z"), ...overrides,
});

describe("platform credentials", () => {
  it("is only for operators who manage platform integrations", () => {
    for (const method of ["list", "save", "test"] as const) {
      expect(Reflect.getMetadata(PLATFORM_OPERATOR_PERMISSION_KEY, OperatorPlatformIntegrationsController.prototype[method]))
        .toBe("platform.integrations.manage");
    }
    expect(platformOperatorCan("administrator", "platform.integrations.manage")).toBe(true);
    expect(platformOperatorCan("account_billing_operator", "platform.integrations.manage")).toBe(false);
    expect(platformOperatorCan("support_observer", "platform.integrations.manage")).toBe(false);
  });

  it("is Not set until every required field is saved, then Set, then the latest test", () => {
    expect(credentialStatus(row({ clientId: "123456", clientSecretLast4: "abcd", configId: "987654" }))).toBe("not_set");
    const complete = row({ clientId: "123456", clientSecretLast4: "abcd", configId: "987654", webhookSecretLast4: "wxyz" });
    expect(credentialStatus(complete)).toBe("set");
    expect(credentialStatus({ ...complete, testStatus: "passed", testedAt: new Date() })).toBe("tested_ok");
    expect(credentialStatus({ ...complete, testStatus: "failed", testReason: "rejected", testedAt: new Date() })).toBe("test_failed");
    expect(credentialStatus(row({ provider: "intuit", clientId: "ABCDEFGHIJ12", clientSecretLast4: "abcd", environment: "sandbox" }))).toBe("set");
  });

  it("shows secrets only as set · last 4, and only the provider's own fields", () => {
    const view = credentialView(row({ provider: "google", clientId: "1234-abcdefgh.apps.googleusercontent.com", clientSecretLast4: "wxyz" }), null);
    expect(view.values).toEqual({ clientId: "1234-abcdefgh.apps.googleusercontent.com" });
    expect(view.secrets).toEqual({ clientSecret: { set: true, last4: "wxyz" } });
    expect(JSON.stringify(view)).not.toMatch(/sealed/i);
    expect(credentialView(row(), null).secrets).toEqual({
      clientSecret: { set: false, last4: null }, webhookSecret: { set: false, last4: null },
    });
  });

  it("builds one central callback per provider from the public address (the firm travels in OAuth state)", () => {
    const base = "https://api.example.test";
    expect(providerUrls("google", base)).toEqual([{ id: "callback", url: `${base}/api/v1/integrations/google/oauth/callback` }]);
    expect(providerUrls("intuit", base)).toEqual([
      { id: "callback", url: `${base}/api/v1/integrations/providers/quickbooks/oauth/callback` },
      { id: "webhook", url: `${base}/api/v1/integrations/providers/webhooks/quickbooks` },
    ]);
    expect(providerUrls("zoho", base)).toEqual([{ id: "callback", url: `${base}/api/v1/integrations/providers/zoho_books/oauth/callback` }]);
    expect(providerUrls("meta", base)).toEqual([{ id: "webhook", url: `${base}/api/v1/integrations/providers/webhooks/whatsapp` }]);
    expect(providerUrls("meta", null)).toEqual([]);
  });

  it("accepts an HTTPS origin (plain HTTP only on this machine) and nothing with a path", () => {
    expect(normalizePublicApiBase("https://api.example.test/")).toBe("https://api.example.test");
    expect(normalizePublicApiBase("http://localhost:8001")).toBe("http://localhost:8001");
    for (const value of ["http://api.example.test", "https://api.example.test/api/v1", "https://api.example.test?x=1", "ftp://x", "api.example.test"]) {
      expect(() => normalizePublicApiBase(value)).toThrow();
    }
  });

  it("validates each provider's formats, keeps unknown fields out and treats null as remove", () => {
    expect(planCredentialChange("meta", {
      clientId: " 1234567890 ", configId: "112233445566", graphVersion: "v23.0", clientSecret: "0123456789abcdef0123456789abcdef", webhookSecret: null,
    })).toEqual({
      values: { clientId: "1234567890", configId: "112233445566", graphVersion: "v23.0" },
      replace: { clientSecret: "0123456789abcdef0123456789abcdef" },
      remove: ["webhookSecret"],
    });
    expect(planCredentialChange("zoho", { clientId: "", dataCenter: "in" })).toEqual({ values: { clientId: null, dataCenter: "in" }, replace: {}, remove: [] });
    expect(() => planCredentialChange("meta", { clientId: "my-app" })).toThrow("Meta app ID");
    expect(() => planCredentialChange("meta", { configId: "abc" })).toThrow("configuration ID");
    expect(() => planCredentialChange("intuit", { environment: "staging" })).toThrow("sandbox or production");
    expect(() => planCredentialChange("zoho", { dataCenter: "uk" })).toThrow("data center");
    expect(() => planCredentialChange("google", { clientId: "not-a-google-id" })).toThrow("googleusercontent");
    expect(() => planCredentialChange("google", { webhookSecret: "0123456789abcdef0123" })).toThrow("doesn't apply");
    expect(() => planCredentialChange("zoho", { configId: "123456" })).toThrow("doesn't apply");
    expect(() => planCredentialChange("intuit", { clientSecret: "short" })).toThrow("at least 16");
    expect(() => planCredentialChange("intuit", { clientSecret: "has a space in it 1234" })).toThrow("no spaces");
    expect(planCredentialChange("platform", { publicApiBase: "https://api.example.test" }).values).toEqual({ publicApiBase: "https://api.example.test" });
  });
});
