import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateRuntimeConfig } from "../config/runtime-config";
import { deliverPortalOtp } from "../commercial/portal-otp-delivery";
import { CrmNotificationsService } from "../crm/notifications/crm-notifications.service";
import { TransactionalEmailService } from "../email/transactional-email.service";
import { DeliveryAllowlist, NOT_ALLOWLISTED } from "./delivery-allowlist";

const LIST = "qa@palm.test, *@wodana.invalid, +971500000001";
const workspaceId = "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a";

afterEach(() => vi.unstubAllGlobals());

describe("DELIVERY_ALLOWLIST", () => {
  it("means no guard when it is unset or empty", () => {
    for (const raw of [undefined, "", " , "]) {
      const allowlist = DeliveryAllowlist.parse(raw);
      expect(allowlist.enabled).toBe(false);
      expect(allowlist.allowsEmail("owner@real-company.example")).toBe(true);
      expect(allowlist.allowsPhone("+971501234567")).toBe(true);
    }
  });

  it("lets exact emails, *@domain and E.164 numbers through and nothing else", () => {
    const allowlist = DeliveryAllowlist.parse(LIST);
    expect(allowlist.allowsEmail("QA@Palm.test")).toBe(true);
    expect(allowlist.allowsEmail("anyone@wodana.invalid")).toBe(true);
    expect(allowlist.allowsEmail("operations@real-company.example")).toBe(false);
    expect(allowlist.allowsEmail("qa@palm.test.evil.example")).toBe(false);
    expect(allowlist.allowsPhone("+971 50 000 0001")).toBe(true);
    expect(allowlist.allowsPhone("971500000001")).toBe(true);
    expect(allowlist.allowsPhone("+971500000002")).toBe(false);
    expect(allowlist.allows({ email: "someone@else.example", phone: "+971500000001" })).toBe(true);
    expect(allowlist.allows({})).toBe(false);
  });

  it("refuses a malformed entry instead of guessing", () => {
    expect(() => DeliveryAllowlist.parse("qa@palm.test, 0501234567")).toThrow(/E\.164/);
    expect(() => DeliveryAllowlist.parse("*@*")).toThrow(/DELIVERY_ALLOWLIST/);
  });

  it("is refused in production and allowed in UAT", () => {
    const base = { DATABASE_URL: "postgresql://localhost/wodana", AUTH_MODE: "development", DELIVERY_ALLOWLIST: LIST };
    expect(() => validateRuntimeConfig({ ...base, ENVIRONMENT: "production" })).toThrow(/remove it in production/);
    expect(() => validateRuntimeConfig({ ...base, ENVIRONMENT: "uat" })).not.toThrow();
    expect(() => validateRuntimeConfig({ ...base, ENVIRONMENT: "production", DELIVERY_ALLOWLIST: "" })).not.toThrow();
    expect(() => validateRuntimeConfig({ ...base, DELIVERY_ALLOWLIST: "not-an-address" })).toThrow(/DELIVERY_ALLOWLIST entry/);
  });
});

describe("the guard on every Business Core delivery", () => {
  const mailgun = { MAILGUN_API_KEY: "key", MAILGUN_DOMAIN: "mg.example.com", MAILGUN_FROM: "Studio <notices@mg.example.com>" };

  it("sends transactional email to a listed recipient and suppresses anyone else (not_allowlisted)", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: "<m1@mg>" }) }));
    vi.stubGlobal("fetch", fetcher);
    const email = new TransactionalEmailService(new ConfigService({ ...mailgun, DELIVERY_ALLOWLIST: LIST }));
    const message = { subject: "Reset", text: "t", html: "<p>t</p>" };
    await expect(email.send({ ...message, to: "qa@palm.test" })).resolves.toMatchObject({ status: "sent" });
    await expect(email.send({ ...message, to: "owner@real-company.example" }))
      .resolves.toEqual({ status: "not_configured", provider: null, messageId: null, suppressedReason: NOT_ALLOWLISTED });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("sends to everyone when the list is unset", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: "<m1@mg>" }) }));
    vi.stubGlobal("fetch", fetcher);
    const email = new TransactionalEmailService(new ConfigService(mailgun));
    await expect(email.send({ to: "owner@real-company.example", subject: "Reset", text: "t", html: "<p>t</p>" })).resolves.toMatchObject({ status: "sent" });
  });

  it("never asks WhatsApp to send a portal code to an unlisted number", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const config = new ConfigService({ DELIVERY_ALLOWLIST: LIST, BUSINESS_CORE_INTERNAL_TOKEN: "t".repeat(40) });
    await expect(deliverPortalOtp(config, workspaceId, "c", "+971509999999", "123456")).rejects.toThrow(/WhatsApp could not accept/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("suppresses queued email, WhatsApp and push to unlisted recipients before the worker gets them", async () => {
    const rows = [
      { id: "e1", recipientType: "user", recipientId: "u-listed", channel: "email", eventType: "crm.lead.assigned" },
      { id: "e2", recipientType: "user", recipientId: "u-owner", channel: "email", eventType: "crm.lead.assigned" },
      { id: "w1", recipientType: "party", recipientId: "p1", channel: "whatsapp", eventType: "quote.issued" },
      { id: "p1", recipientType: "user", recipientId: "u-owner", channel: "push", eventType: "crm.lead.assigned" },
    ];
    const emails: Record<string, string> = { "u-listed": "qa@palm.test", "u-owner": "owner@real-company.example" };
    const suppressed: unknown[][] = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("WITH due AS")) return { rows };
      if (sql.includes("FROM notification_preferences")) return { rows: [] };
      if (sql.includes("FROM crm_consents")) return { rows: [{ status: "granted", expires_at: null }] };
      if (sql.includes("FROM device_endpoints")) return { rows: [{ tokenReference: "redis:push:x", platform: "ios" }] };
      if (sql.includes("FROM users")) return { rows: [{ email: emails[String(values[0])] }] };
      if (sql.includes("FROM crm_contact_points")) return { rows: [{ value: "+971 50 999 9999", normalizedValue: "+971509999999", type: "phone" }] };
      if (sql.includes("status='suppressed'")) { suppressed.push(values); return { rows: [] }; }
      return { rows: [] };
    });
    const database = { tenantTransaction: vi.fn(async (_w: string, _a: string, work: (client: unknown) => unknown) => work({ query })) };
    const service = new CrmNotificationsService(database as never, {} as never, {} as never, undefined, undefined, undefined,
      new ConfigService({ DELIVERY_ALLOWLIST: LIST }));
    const { items } = await service.claimInternal({ workspaceId });
    expect(items.map((item) => item.id)).toEqual(["e1"]);
    expect(suppressed.map((values) => [values[2], values[0]])).toEqual([["e2", NOT_ALLOWLISTED], ["w1", NOT_ALLOWLISTED], ["p1", NOT_ALLOWLISTED]]);
  });

  it("records the worker's own refusal as suppressed, not as a provider failure", async () => {
    const updates: unknown[][] = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("SELECT * FROM notifications")) return { rowCount: 1, rows: [{ channel: "whatsapp", recipient_id: "p1", idempotency_key: "k" }] };
      if (sql.includes("FROM notification_delivery_attempts")) return { rowCount: 0, rows: [] };
      if (sql.startsWith("UPDATE notifications")) { updates.push(values); return { rows: [{ id: "w1", status: values[0] }] }; }
      return { rows: [] };
    });
    const database = { tenantTransaction: vi.fn(async (_w: string, _a: string, work: (client: unknown) => unknown) => work({ query })) };
    const service = new CrmNotificationsService(database as never, {} as never, { record: vi.fn() } as never, { record: vi.fn() } as never);
    await service.resultInternal("w1", { workspaceId, attempt: 1, provider: "whatsapp", result: "permanent_failure", errorCode: NOT_ALLOWLISTED });
    expect(updates[0]).toEqual(["suppressed", null, workspaceId, "w1", NOT_ALLOWLISTED]);
  });
});
