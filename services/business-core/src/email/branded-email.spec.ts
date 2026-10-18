import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { renderBrandedEmail, WODANA_BRAND } from "./branded-email";
import { TransactionalEmailService } from "./transactional-email.service";

const palm = { displayName: "Palm Living", loginSlug: "palm-living", logoUrl: null, logoAssetId: "a1b2", primaryColor: "#0f5c4a" };

describe("tenant-branded email", () => {
  it("uses the tenant name, logo and accent and escapes every value", () => {
    const { html, text } = renderBrandedEmail({
      brand: { name: "Palm <Living>", logoUrl: "https://app.example/logo.png", accentColor: "#0f5c4a" },
      preheader: "Join", heading: "Join <b>", paragraphs: ["Hello & welcome"],
      action: { label: "Accept", url: "https://app.example/login?a=1&b=2" },
    });
    expect(html).toContain('<img src="https://app.example/logo.png" alt="Palm &lt;Living&gt;"');
    expect(html).toContain("background:#0f5c4a;color:#ffffff");
    expect(html).toContain("Join &lt;b&gt;");
    expect(html).toContain("a=1&amp;b=2");
    expect(html).not.toContain("<b>");
    expect(text).toContain("Accept: https://app.example/login?a=1&b=2");
  });

  it("renders right-to-left and falls back to a safe accent", () => {
    const { html } = renderBrandedEmail({ brand: { ...WODANA_BRAND, accentColor: "red;x" }, preheader: "", heading: "", paragraphs: [], action: { label: "Open", url: "https://x.example" }, direction: "rtl", lang: "ar" });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("text-align:right");
    expect(html).toContain(`background:${WODANA_BRAND.accentColor}`);
  });

  it("brands invitations from the tenant record and links to the tenant sign-in", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [palm] }) };
    const service = new TransactionalEmailService(new ConfigService({ WEB_ORIGIN: "https://wodana.example" }), database as never);
    const send = vi.spyOn(service, "send").mockResolvedValue({ status: "sent", provider: "mailgun", messageId: "m" });
    await service.sendWorkspaceInvitation({ workspaceId: "w1", email: "sara@palm.ae", expiresAt: new Date("2026-10-01T00:00:00Z"), invitationToken: "tok", inviterName: "Omar", recipientName: "Sara", roleCodes: ["sales_manager"], workspaceName: "Palm Living" });
    const message = send.mock.calls[0][0];
    expect(message.fromName).toBe("Palm Living");
    expect(message.html).toContain('src="https://wodana.example/api/auth/tenant-logo/palm-living?v=a1b2"');
    expect(message.html).toContain("background:#0f5c4a");
    expect(message.text).toContain("https://wodana.example/login?tenant=palm-living&invitation=tok");
    expect(message.html).not.toMatch(/>Wodana</);
  });

  it("uses the tenant name in the password reset subject and sender", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [palm] }) };
    const service = new TransactionalEmailService(new ConfigService({ WEB_ORIGIN: "https://wodana.example" }), database as never);
    const send = vi.spyOn(service, "send").mockResolvedValue({ status: "sent", provider: "mailgun", messageId: "m" });
    await service.sendPasswordReset({ email: "sara@palm.ae", resetToken: "r", tenantSlug: "palm-living" });
    expect(send.mock.calls[0][0]).toMatchObject({ subject: "Reset your Palm Living password", fromName: "Palm Living" });
  });

  it("sends from the tenant name on the configured address", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "id" }) });
    vi.stubGlobal("fetch", fetchMock);
    const service = new TransactionalEmailService(new ConfigService({ MAILGUN_API_KEY: "k", MAILGUN_DOMAIN: "mg.example", MAILGUN_FROM: "Wodana <hello@mg.example>" }));
    await service.send({ to: "a@b.c", subject: "s", text: "t", html: "h", fromName: 'Palm "Living"\r\n' });
    expect((fetchMock.mock.calls[0][1].body as FormData).get("from")).toBe('Palm Living <hello@mg.example>');
    vi.unstubAllGlobals();
  });

  it("sends branded security notices for password and two-step changes", async () => {
    const database = { query: vi.fn().mockResolvedValue({ rows: [palm] }) };
    const service = new TransactionalEmailService(new ConfigService({ WEB_ORIGIN: "https://wodana.example" }), database as never);
    const send = vi.spyOn(service, "send").mockResolvedValue({ status: "sent", provider: "mailgun", messageId: "m" });
    await service.sendSecurityNotice({ email: "sara@palm.ae", kind: "password_changed", loginSlug: "palm-living" });
    await service.sendSecurityNotice({ email: "sara@palm.ae", kind: "mfa_disabled", workspaceId: "w1" });
    expect(send.mock.calls.map(([message]) => message.subject)).toEqual([
      "Your Palm Living password was changed",
      "Two-step verification was turned off for Palm Living",
    ]);
    expect(send.mock.calls[0][0].text).toContain("https://wodana.example/login?tenant=palm-living");
    expect(send.mock.calls[0][0].html).toContain("did not make this change");
  });
});
