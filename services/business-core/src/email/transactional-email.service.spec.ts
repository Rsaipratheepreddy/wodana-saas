import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailSendLimiter } from "./email-send-limiter";
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
      // Delivery health shows why, without the recipient.
      errorCode: "MAILGUN_HTTP_401",
    });
  });
  describe("send limit, throttling and retries", () => {
    const mailgun = { MAILGUN_API_KEY: "test-api-key", MAILGUN_DOMAIN: "mg.example.com" };
    const message = { to: "member@example.com", subject: "Notice", text: "Notice", html: "<p>Notice</p>" };
    const answer = (status: number, headers: Record<string, string> = {}) => ({ ok: status < 300, status, headers: new Headers(headers), json: async () => ({ id: "m" }) });

    it("marks a Mailgun 429 retryable with its Retry-After, and holds every send of the process back meanwhile", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(429, { "Retry-After": "20" })));
      const limiter = new EmailSendLimiter({ perSecond: 5, perMinute: 120 });
      const service = new TransactionalEmailService(new ConfigService(mailgun), undefined, undefined, limiter);
      const before = Date.now();
      await expect(service.send(message)).resolves.toEqual({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_HTTP_429", retryable: true, retryAfterMs: 20_000 });
      expect(limiter.nextSlotAt()).toBeGreaterThanOrEqual(before + 20_000);
    });

    it("retries a 5xx and a network error; a 4xx other than 429 stays permanent", async () => {
      const service = new TransactionalEmailService(new ConfigService(mailgun), undefined, undefined, new EmailSendLimiter({ perSecond: 50, perMinute: 500 }));
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(503)));
      await expect(service.send(message)).resolves.toEqual({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_HTTP_503", retryable: true });
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
      await expect(service.send(message)).resolves.toEqual({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_UNREACHABLE", retryable: true });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(400, { "Retry-After": "20" })));
      await expect(service.send(message)).resolves.toEqual({ status: "failed", provider: "mailgun", messageId: null, errorCode: "MAILGUN_HTTP_400" });
    });

    it("defers, without calling the provider, a send the limit can't fit before the caller's deadline", async () => {
      const fetchMock = vi.fn().mockResolvedValue(answer(200));
      vi.stubGlobal("fetch", fetchMock);
      const service = new TransactionalEmailService(new ConfigService(mailgun), undefined, undefined, new EmailSendLimiter({ perSecond: 2, perMinute: 120 }));
      const notAfter = Date.now() + 100;
      await service.send(message, { notAfter });
      await service.send(message, { notAfter });
      const third = await service.send(message, { notAfter });
      expect(third).toMatchObject({ status: "failed", provider: "mailgun", errorCode: "EMAIL_RATE_LIMITED", retryable: true, deferred: true });
      expect(third.retryAfterMs).toBeGreaterThan(800);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries an SES throttle and pauses the process", async () => {
      const throttle = Object.assign(new Error("Maximum sending rate exceeded."), { name: "TooManyRequestsException", $metadata: { httpStatusCode: 429 } });
      const limiter = new EmailSendLimiter();
      const service = new TransactionalEmailService(new ConfigService({ SES_FROM: "no-reply@mail.example" }), undefined, vi.fn().mockRejectedValue(throttle), limiter);
      const before = Date.now();
      await expect(service.send(message)).resolves.toEqual({ status: "failed", provider: "ses", messageId: null, errorCode: "SES_TooManyRequestsException", retryable: true });
      expect(limiter.nextSlotAt()).toBeGreaterThanOrEqual(before + 1_000);
    });

    it("takes no slot for a message that isn't sent (email not set up, or not allowlisted)", async () => {
      const limiter = new EmailSendLimiter({ perSecond: 1, perMinute: 1 });
      const service = new TransactionalEmailService(new ConfigService({}), undefined, undefined, limiter);
      for (let index = 0; index < 3; index++) await expect(service.send(message)).resolves.toMatchObject({ status: "not_configured" });
      expect(limiter.nextSlotAt()).toBeLessThanOrEqual(Date.now());
    });
  });
  describe("Amazon SES", () => {
    const message = { to: "member@example.com", subject: "Welcome", text: "Hello", html: "<p>Hello</p>", fromName: "Palm Studio, Dubai" };

    it("sends through SES from the verified address with the tenant as the display name", async () => {
      const sender = vi.fn().mockResolvedValue("ses-message-id");
      const service = new TransactionalEmailService(new ConfigService({ SES_FROM: "Wodana <no-reply@mail.example>", SES_REGION: "ap-south-1" }), undefined, sender);

      expect(service.provider()).toBe("ses");
      expect(service.configured()).toBe(true);
      await expect(service.send(message)).resolves.toEqual({ status: "sent", provider: "ses", messageId: "ses-message-id" });
      expect(sender).toHaveBeenCalledWith({
        region: "ap-south-1",
        from: "\"Palm Studio, Dubai\" <no-reply@mail.example>",
        to: "member@example.com",
        subject: "Welcome",
        text: "Hello",
        html: "<p>Hello</p>",
        configurationSet: undefined,
      });
    });

    it("prefers Mailgun when both are set, unless EMAIL_PROVIDER picks SES", () => {
      const both = { MAILGUN_API_KEY: "key", MAILGUN_DOMAIN: "mg.example", SES_FROM: "no-reply@mail.example" };
      expect(new TransactionalEmailService(new ConfigService(both)).provider()).toBe("mailgun");
      expect(new TransactionalEmailService(new ConfigService({ ...both, EMAIL_PROVIDER: "ses" })).provider()).toBe("ses");
      expect(new TransactionalEmailService(new ConfigService({ EMAIL_PROVIDER: "ses" })).provider()).toBeNull();
    });

    it("reports a safe error code when SES refuses the message", async () => {
      const refusal = Object.assign(new Error("Email address is not verified."), { name: "MessageRejected" });
      const service = new TransactionalEmailService(new ConfigService({ SES_FROM: "no-reply@mail.example" }), undefined, vi.fn().mockRejectedValue(refusal));

      await expect(service.send(message)).resolves.toEqual({ status: "failed", provider: "ses", messageId: null, errorCode: "SES_MessageRejected" });
    });

    it("still honours the delivery allowlist", async () => {
      const sender = vi.fn();
      const service = new TransactionalEmailService(new ConfigService({ SES_FROM: "no-reply@mail.example", DELIVERY_ALLOWLIST: "allowed@example.com" }), undefined, sender);

      await expect(service.send(message)).resolves.toMatchObject({ status: "not_configured", suppressedReason: expect.any(String) });
      expect(sender).not.toHaveBeenCalled();
    });
  });
  describe("conversation replies (PLM-025)", () => {
    const reply = {
      workspaceId: "11111111-1111-4111-8111-111111111111", to: "noura@example.com", subject: "Re: Villa", body: "Thursday works.\nSee you then.",
      replyTo: "plm-abcdefghij@in.wodana.ai", headers: { "Message-Id": "<m.1@in.wodana.ai>", "In-Reply-To": "<n1@example.com>", References: "<a@x> <n1@example.com>" },
    };

    it("sends through Mailgun with Reply-To on the inbound address and the threading headers", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "<m.1@in.wodana.ai>" }) });
      vi.stubGlobal("fetch", fetchMock);
      const service = new TransactionalEmailService(new ConfigService({ MAILGUN_API_KEY: "k", MAILGUN_DOMAIN: "mg.example.com", MAILGUN_FROM: "Wodana <hello@mg.example.com>" }));
      vi.spyOn(service, "brand").mockResolvedValue({ name: "Palm Living", logoUrl: null, accentColor: "#123456", loginSlug: "plm" });

      await expect(service.sendConversationReply(reply)).resolves.toMatchObject({ status: "sent", messageId: "<m.1@in.wodana.ai>" });
      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get("from")).toBe("Palm Living <hello@mg.example.com>");
      expect(form.get("to")).toBe("noura@example.com");
      expect(form.get("subject")).toBe("Re: Villa");
      expect(form.get("h:Reply-To")).toBe("Palm Living <plm-abcdefghij@in.wodana.ai>");
      expect(form.get("h:Message-Id")).toBe("<m.1@in.wodana.ai>");
      expect(form.get("h:In-Reply-To")).toBe("<n1@example.com>");
      expect(form.get("h:References")).toBe("<a@x> <n1@example.com>");
      expect(String(form.get("text"))).toContain("Thursday works.\nSee you then.");
      expect(String(form.get("html"))).toContain("Powered by Wodana");
      expect(String(form.get("html"))).not.toContain("<h1");
    });

    it("never lets a header value carry a line break", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "x" }) });
      vi.stubGlobal("fetch", fetchMock);
      const service = new TransactionalEmailService(new ConfigService({ MAILGUN_API_KEY: "k", MAILGUN_DOMAIN: "mg.example.com" }));
      await service.send({ to: "a@b.co", subject: "s", text: "t", html: "h", replyTo: "x@y.co\r\nBcc: evil@z.co", headers: { "In-Reply-To": "<a@b>\r\nBcc: evil@z.co" } });
      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get("h:Reply-To")).toBe("x@y.co Bcc: evil@z.co");
      expect(form.get("h:In-Reply-To")).toBe("<a@b> Bcc: evil@z.co");
      expect(form.get("h:Bcc")).toBeNull();
    });

    it("passes Reply-To and the headers to SES", async () => {
      const sender = vi.fn().mockResolvedValue("ses-id");
      const service = new TransactionalEmailService(new ConfigService({ SES_FROM: "no-reply@mail.example" }), undefined, sender);
      vi.spyOn(service, "brand").mockResolvedValue({ name: "Palm Living", logoUrl: null, accentColor: "#123456", loginSlug: "plm" });
      await service.sendConversationReply(reply);
      expect(sender).toHaveBeenCalledWith(expect.objectContaining({ replyTo: "Palm Living <plm-abcdefghij@in.wodana.ai>", headers: reply.headers }));
    });
  });
});
