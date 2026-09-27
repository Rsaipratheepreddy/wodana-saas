import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionalEmailService } from "./transactional-email.service";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TransactionalEmailService", () => {
  it("links recovery email to the reset form and retains the tenant", async () => {
    const service = new TransactionalEmailService(new ConfigService({ WEB_ORIGIN: "https://wodana.example,https://admin.wodana.example" }));
    const send = vi.spyOn(service, "send").mockResolvedValue({ status: "sent", provider: "mailgun", messageId: "reset" });
    await service.sendPasswordReset({ email: "member@example.com", resetToken: "token-example", tenantSlug: "iglo-architects" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: "member@example.com",
      text: expect.stringContaining("https://wodana.example/login?reset=token-example&tenant=iglo-architects"),
      html: expect.stringContaining("&amp;tenant=iglo-architects"),
    }));
  });

  it("keeps invitation creation usable when Mailgun is not configured", async () => {
    const service = new TransactionalEmailService(new ConfigService({}));

    await expect(service.send({
      to: "member@example.com",
      subject: "Invitation",
      text: "Invitation",
      html: "<p>Invitation</p>",
    })).resolves.toEqual({
      status: "not_configured",
      provider: null,
      messageId: null,
    });
  });

  it("sends multipart transactional email through the configured Mailgun endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "mailgun-message-id" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new TransactionalEmailService(new ConfigService({
      MAILGUN_API_KEY: "test-api-key",
      MAILGUN_DOMAIN: "mg.example.com",
      MAILGUN_FROM: "Wodana <invite@mg.example.com>",
      MAILGUN_BASE_URL: "https://api.eu.mailgun.net",
    }));

    await expect(service.send({
      to: "member@example.com",
      subject: "Invitation",
      text: "Invitation text",
      html: "<p>Invitation HTML</p>",
    })).resolves.toEqual({
      status: "sent",
      provider: "mailgun",
      messageId: "mailgun-message-id",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.eu.mailgun.net/v3/mg.example.com/messages");
    expect(init.method).toBe("POST");
    const body = init.body as FormData;
    expect(body.get("from")).toBe("Wodana <invite@mg.example.com>");
    expect(body.get("to")).toBe("member@example.com");
    expect(body.get("subject")).toBe("Invitation");
    expect(body.get("text")).toBe("Invitation text");
    expect(body.get("html")).toBe("<p>Invitation HTML</p>");
  });

  it("builds the current Wodana activation URL and escapes invitation content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: "invitation-message-id" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new TransactionalEmailService(new ConfigService({
      WEB_ORIGIN: "https://app.wodana.example,https://admin.wodana.example",
      MAILGUN_API_KEY: "test-api-key",
      MAILGUN_DOMAIN: "mg.example.com",
    }));

    await service.sendWorkspaceInvitation({
      email: "maya@example.com",
      expiresAt: new Date("2026-09-13T12:00:00.000Z"),
      invitationToken: "secure-token",
      inviterName: "Owner <script>",
      recipientName: "Maya & Co",
      roleCodes: ["project_member"],
      workspaceName: "Iglo <Studio>",
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = init.body as FormData;
    expect(body.get("text")).toContain(
      "https://app.wodana.example/login?invitation=secure-token",
    );
    expect(body.get("html")).toContain("Iglo &lt;Studio&gt;");
    expect(body.get("html")).toContain("Hello Maya &amp; Co,");
    expect(body.get("html")).not.toContain("Owner <script>");
  });

  it("greets neutrally when the invited person was not given a name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "invitation-message-id" }) });
    vi.stubGlobal("fetch", fetchMock);
    const service = new TransactionalEmailService(new ConfigService({
      WEB_ORIGIN: "https://app.wodana.example",
      MAILGUN_API_KEY: "test-api-key",
      MAILGUN_DOMAIN: "mg.example.com",
    }));

    await service.sendWorkspaceInvitation({
      email: "qs@example.com",
      expiresAt: new Date("2026-09-13T12:00:00.000Z"),
      invitationToken: "secure-token",
      inviterName: "Owner",
      recipientName: null,
      roleCodes: ["quantity_surveyor"],
      workspaceName: "Studio",
    });

    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData;
    expect(body.get("text")).toContain("Hello,");
    expect(body.get("text")).not.toContain("Hello Qs");
    expect(body.get("text")).not.toContain("Hello qs");
    expect(body.get("html")).toContain("Hello,");
  });

  it("invites a client in the tenant's name with the portal address and how to sign in; Wodana only powers it", async () => {
    const service = new TransactionalEmailService(new ConfigService({ WEB_ORIGIN: "https://app.example.com" }));
    const send = vi.spyOn(service, "send").mockResolvedValue({ status: "sent", provider: "mailgun", messageId: "inv" });
    await service.sendPortalInvitation({
      workspaceId: "4f0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", to: "client@palmliving.test", recipientName: "Maya Client", projectName: "Villa 12", company: "Studio Interiors",
      portalUrl: "https://app.example.com/portal/studio", inviteUrl: "https://app.example.com/portal/studio?invite=tok-en", phoneHint: "23", channel: "whatsapp",
      expiresAt: new Date("2026-10-12T00:00:00Z"),
    });
    const message = send.mock.calls[0][0];
    expect(message).toMatchObject({ to: "client@palmliving.test", subject: "Your project page with Studio Interiors", fromName: "Studio Interiors" });
    expect(message.text).toContain("Hello Maya Client,");
    expect(message.text).toContain("Open your project page: https://app.example.com/portal/studio?invite=tok-en");
    expect(message.text).toContain("mobile number ending in 23");
    expect(message.text).toContain("by WhatsApp");
    expect(message.text).toContain("expires on October 12, 2026. You can always sign in at https://app.example.com/portal/studio.");
    expect(message.html).toContain("Powered by Wodana");
    expect(message.html.replace("Powered by Wodana", "")).not.toContain("Wodana");
  });

  it("returns a safe failure result when Mailgun rejects the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const service = new TransactionalEmailService(new ConfigService({
      MAILGUN_API_KEY: "test-api-key",
      MAILGUN_DOMAIN: "mg.example.com",
    }));

    await expect(service.send({
      to: "member@example.com",
      subject: "Invitation",
      text: "Invitation",
      html: "<p>Invitation</p>",
    })).resolves.toEqual({
      status: "failed",
      provider: "mailgun",
      messageId: null,
    });
  });
});
