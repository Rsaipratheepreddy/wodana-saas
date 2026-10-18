import { readableOnWhite } from "./readable-colour";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { deliveryAllowlist, NOT_ALLOWLISTED } from "../notifications/delivery-allowlist";
import { renderBrandedEmail, WODANA_BRAND, type EmailBrand } from "./branded-email";
import { mailgunFailure, mailgunTransportFailure, PROVIDER_THROTTLE_PAUSE_CAP_MS, PROVIDER_THROTTLE_PAUSE_MS, sesFailure, type ProviderFailure } from "./email-retry";
import { emailSendRate, EmailSendLimiter, processEmailSendLimiter } from "./email-send-limiter";

export type EmailDeliveryStatus = "sent" | "not_configured" | "failed";
export type EmailProvider = "mailgun" | "ses";

/** Sends one prepared message through Amazon SES; replaced in tests. */
export type SesSender = (input: { region: string; from: string; to: string; subject: string; text: string; html: string; configurationSet?: string; attachments?: EmailAttachment[]; replyTo?: string; headers?: Record<string, string> }) => Promise<string | null>;

/** A file sent with a message (a booking's .ics invitation as text, a chat reply's file as bytes). */
export type EmailAttachment = { filename: string; contentType: string; content: string | Uint8Array };

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  provider: EmailProvider | null;
  messageId: string | null;
  /** Why nothing was sent although email is set up (the DELIVERY_ALLOWLIST guard). */
  suppressedReason?: typeof NOT_ALLOWLISTED;
  /** Why a send failed, without recipient data (e.g. MAILGUN_HTTP_401, MAILGUN_TIMEOUT, SES_MessageRejected). */
  errorCode?: string;
  /** Worth trying again later: provider throttling (HTTP 429), a provider error (5xx), a timeout or the network. */
  retryable?: boolean;
  /** How long to wait first: the provider's Retry-After, or when the send limit frees a slot. */
  retryAfterMs?: number;
  /** Nothing left this process: the send limit had no slot before the caller's deadline. Not an attempt. */
  deferred?: boolean;
}

/** How long a send may wait for a slot; a dispatch loop passes its own deadline. */
export type EmailSendOptions = { notAfter?: number };
/** An interactive send (a sign-in code, an invitation) waits at most this long for a slot, then fails as rate limited. */
export const EMAIL_SEND_MAX_WAIT_MS = 30_000;

interface TransactionalMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Sender display name, normally the tenant; the address stays the configured sending domain. */
  fromName?: string;
  attachments?: EmailAttachment[];
  /** Where the recipient's reply goes (a chat's inbound address), as `Name <address>` or a bare address. */
  replyTo?: string;
  /** Threading headers for a conversation reply: Message-Id, In-Reply-To and References only. */
  headers?: Partial<Record<"Message-Id" | "In-Reply-To" | "References", string>>;
}

interface WorkspaceInvitationMessage {
  /** Resolves the tenant brand; omitted only by callers without a workspace (Wodana brand). */
  workspaceId?: string;
  email: string;
  expiresAt: Date;
  invitationToken: string;
  inviterName: string;
  /** The invited person's display name when one was given; null greets them neutrally. */
  recipientName: string | null;
  roleCodes: string[];
  workspaceName: string;
}

const DEFAULT_MAILGUN_BASE_URL = "https://api.mailgun.net";

const sesClients = new Map<string, SESv2Client>();

/** Credentials come from the default AWS chain (the server's instance role in production). */
const sendThroughSes: SesSender = async ({ region, from, to, subject, text, html, configurationSet, attachments, replyTo, headers }) => {
  let client = sesClients.get(region);
  if (!client) {
    client = new SESv2Client({ region });
    sesClients.set(region, client);
  }
  const result = await client.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: { Text: { Data: text, Charset: "UTF-8" }, Html: { Data: html, Charset: "UTF-8" } },
        ...(headers && Object.keys(headers).length ? { Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })) } : {}),
        ...(attachments?.length ? { Attachments: attachments.map((file) => ({ FileName: file.filename, ContentType: file.contentType, RawContent: typeof file.content === "string" ? Buffer.from(file.content, "utf8") : Buffer.from(file.content) })) } : {}),
      },
    },
    ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
    ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
  }), { abortSignal: AbortSignal.timeout(30_000) });
  return result.MessageId ?? null;
};

/** `Name <address>` with the name quoted only when RFC 5322 needs it. */
export function fromHeader(displayName: string, address: string) {
  return /[(),.:;@[\]\\]/.test(displayName) ? `"${displayName}" <${address}>` : `${displayName} <${address}>`;
}

/** A header value without line breaks, so nothing can add a header of its own. */
function headerValue(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 1800);
}

/** Only the three threading headers a conversation reply sets, each cleaned of line breaks. */
function threadingHeaders(headers: TransactionalMessage["headers"]): Record<string, string> {
  const allowed = ["Message-Id", "In-Reply-To", "References"] as const;
  return Object.fromEntries(allowed.flatMap((name) => headers?.[name] ? [[name, headerValue(headers[name]!)]] : []));
}

function readableRole(code: string): string {
  return code
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type BrandRow = { displayName: string; loginSlug: string; logoUrl: string | null; logoAssetId: string | null; primaryColor: string | null };

@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  private readonly sesSender: SesSender;

  /** The process-wide send limit (EMAIL_SEND_PER_SECOND, EMAIL_SEND_PER_MINUTE); a test passes its own. */
  readonly limiter: EmailSendLimiter;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly database?: DatabaseService,
    @Optional() sesSender?: SesSender,
    @Optional() limiter?: EmailSendLimiter,
  ) {
    this.sesSender = sesSender ?? sendThroughSes;
    this.limiter = limiter ?? processEmailSendLimiter(emailSendRate(config));
  }

  private origin() {
    return this.config.get<string>("WEB_ORIGIN", "http://localhost:3000").split(",")[0].trim();
  }

  /** Resolves the tenant's vanity subdomain (e.g. https://plm.wodana.ai) when the base domain is wodana.ai. */
  private tenantOrigin(brand: { loginSlug?: string | null }) {
    const base = this.origin();
    if (!brand.loginSlug) return base;
    try {
      const url = new URL(base);
      if (url.hostname.endsWith("wodana.ai")) {
        url.hostname = `${brand.loginSlug}.wodana.ai`;
        return url.toString().replace(/\/+$/, "");
      }
    } catch { /* keep base */ }
    return base;
  }

  /** Whether the platform mailer (team and client-portal emails) has its sending credentials. */
  configured() {
    return this.provider() !== null;
  }

  /** EMAIL_PROVIDER picks the mailer; without it Mailgun is used when its keys are set, otherwise SES when SES_FROM is. */
  provider(): EmailProvider | null {
    const mailgun = Boolean(this.config.get<string>("MAILGUN_API_KEY", "").trim() && this.config.get<string>("MAILGUN_DOMAIN", "").trim());
    const ses = Boolean(this.config.get<string>("SES_FROM", "").trim());
    const chosen = this.config.get<string>("EMAIL_PROVIDER", "").trim().toLowerCase();
    if (chosen === "ses") return ses ? "ses" : null;
    if (chosen === "mailgun") return mailgun ? "mailgun" : null;
    return mailgun ? "mailgun" : ses ? "ses" : null;
  }

  /**
   * Tenant branding for email: the sign-in branding record is the source of truth for name, logo
   * and accent. Falls back to Wodana when the tenant has not configured branding, or to `fallbackName`
   * (the workspace's name) when the caller has one.
   */
  async brand(target: { workspaceId?: string; loginSlug?: string }, fallbackName?: string): Promise<EmailBrand & { loginSlug: string | null }> {
    const fallback = { ...WODANA_BRAND, name: fallbackName?.trim() || WODANA_BRAND.name };
    if (!this.database || (!target.workspaceId && !target.loginSlug)) return { ...fallback, loginSlug: null };
    const result = await this.database.query<BrandRow>(
      `SELECT display_name AS "displayName", login_slug AS "loginSlug", logo_url AS "logoUrl",
              logo_asset_id AS "logoAssetId", primary_color AS "primaryColor"
       FROM tenant_login_branding
       WHERE ($1::uuid IS NOT NULL AND workspace_id = $1::uuid) OR ($2::text IS NOT NULL AND login_slug = $2::text)
       LIMIT 1`,
      [target.workspaceId ?? null, target.loginSlug ?? null],
    ).catch(() => ({ rows: [] as BrandRow[] }));
    const row = result.rows[0];
    if (!row) return { ...fallback, loginSlug: target.loginSlug ?? null };
    const logoUrl = row.logoAssetId
      ? new URL(`/api/auth/tenant-logo/${encodeURIComponent(row.loginSlug)}?v=${row.logoAssetId}`, this.origin()).toString()
      : row.logoUrl && /^https:\/\//.test(row.logoUrl) ? row.logoUrl : null;
    return {
      name: row.displayName,
      logoUrl,
      accentColor: readableOnWhite(row.primaryColor, WODANA_BRAND.accentColor),
      loginSlug: row.loginSlug,
    };
  }

  async sendPasswordReset(input: { email: string; resetToken: string; tenantSlug: string }): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ loginSlug: input.tenantSlug || undefined });
    const origin = this.tenantOrigin(brand);
    const url = new URL("/login", origin);
    url.searchParams.set("reset", input.resetToken);
    if (input.tenantSlug && !url.hostname.startsWith(`${input.tenantSlug}.`)) {
      url.searchParams.set("tenant", input.tenantSlug);
    }
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: `Reset your ${brand.name} password.`,
      heading: "Reset your password",
      paragraphs: [`Use this secure link to choose a new password for ${brand.name}.`],
      action: { label: "Reset password", url: url.toString() },
      footnote: "This link expires in 30 minutes. If you did not request a reset, you can ignore this email.",
    });
    return this.send({ to: input.email, subject: `Reset your ${brand.name} password`, text, html, fromName: brand.name });
  }

  /** Security notice after an account change, so the owner notices changes they did not make. */
  async sendSecurityNotice(input: {
    email: string;
    kind: "password_changed" | "mfa_disabled";
    workspaceId?: string;
    loginSlug?: string;
  }): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: input.workspaceId, loginSlug: input.loginSlug });
    const origin = this.tenantOrigin(brand);
    const signIn = new URL("/login", origin);
    if (brand.loginSlug && !signIn.hostname.startsWith(`${brand.loginSlug}.`)) {
      signIn.searchParams.set("tenant", brand.loginSlug);
    }
    const copy = input.kind === "password_changed"
      ? { subject: `Your ${brand.name} password was changed`, heading: "Your password was changed", body: "The password for your account was just changed and your other sessions were signed out." }
      : { subject: `Two-step verification was turned off for ${brand.name}`, heading: "Two-step verification was turned off", body: "Two-step verification was just turned off for your account. Signing in now needs only your password." };
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: copy.heading,
      heading: copy.heading,
      paragraphs: [copy.body, "If this was you, no action is needed."],
      action: { label: "Review account security", url: signIn.toString() },
      footnote: "If you did not make this change, reset your password now and contact your workspace administrator.",
    });
    return this.send({ to: input.email, subject: copy.subject, text, html, fromName: brand.name });
  }

  async sendWorkspaceInvitation(
    invitation: WorkspaceInvitationMessage,
  ): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: invitation.workspaceId });
    const origin = this.tenantOrigin(brand);
    const activationUrl = new URL("/login", origin);
    if (brand.loginSlug && !activationUrl.hostname.startsWith(`${brand.loginSlug}.`)) {
      activationUrl.searchParams.set("tenant", brand.loginSlug);
    }
    activationUrl.searchParams.set("invitation", invitation.invitationToken);
    const roles = invitation.roleCodes.map(readableRole).join(", ") || "Member";
    const expiresOn = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(invitation.expiresAt);
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: `Join ${invitation.workspaceName}.`,
      heading: `Join ${invitation.workspaceName}`,
      paragraphs: [
        invitation.recipientName?.trim() ? `Hello ${invitation.recipientName.trim()},` : "Hello,",
        `${invitation.inviterName} invited you to join ${invitation.workspaceName} as ${roles}.`,
      ],
      action: { label: "Accept invitation", url: activationUrl.toString() },
      footnote: `This secure link expires on ${expiresOn}. If you were not expecting this invitation, you can ignore this email.`,
    });
    return this.send({ to: invitation.email, subject: `You have been invited to ${invitation.workspaceName}`, text, html, fromName: brand.name });
  }

  /** A notification for a team member (e.g. a new enquiry assigned), in the tenant's brand. */
  async sendStaffNotice(input: { workspaceId: string; to: string; subject: string; body: string; deepLink?: string | null; actionLabel?: string }, options: EmailSendOptions = {}): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: input.workspaceId });
    const origin = this.tenantOrigin(brand);
    const paragraphs = input.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const url = input.deepLink ? new URL(input.deepLink, origin).toString() : null;
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: input.subject,
      heading: input.subject,
      paragraphs,
      ...(url ? { action: { label: input.actionLabel ?? "Open in workspace", url } } : {}),
    });
    return this.send({ to: input.to, subject: input.subject, text, html, fromName: brand.name }, options);
  }

  /**
   * A control-plane alert for Wodana operators (a tenant went into grace, was suspended, lost its domain).
   * Operators are Wodana staff, so the message carries the Wodana brand and links to the control console.
   */
  async sendOperatorNotice(input: { to: string; subject: string; body: string; consolePath?: string | null }): Promise<EmailDeliveryResult> {
    const paragraphs = input.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const url = input.consolePath ? new URL(input.consolePath, this.origin()).toString() : null;
    const { html, text } = renderBrandedEmail({
      brand: WODANA_BRAND,
      preheader: input.subject,
      heading: input.subject,
      paragraphs,
      ...(url ? { action: { label: "Open in Wodana Control", url } } : {}),
    });
    return this.send({ to: input.to, subject: input.subject, text, html, fromName: WODANA_BRAND.name });
  }

  /**
   * A client's invitation to the portal, in the tenant's brand: where their project page is, how to sign in
   * (their mobile number and a code by WhatsApp or email), and a link that opens it with their number ready.
   */
  async sendPortalInvitation(input: {
    workspaceId: string; to: string; recipientName: string; projectName: string; company: string; portalUrl: string; inviteUrl: string;
    phoneHint: string; channel: "whatsapp" | "email"; expiresAt: Date;
  }): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: input.workspaceId }, input.company);
    const expiresOn = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(input.expiresAt);
    const code = input.channel === "whatsapp" ? "A 6-digit code arrives by WhatsApp, or by email when WhatsApp can't reach you." : "A 6-digit code arrives by email.";
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: `Follow ${input.projectName} with ${brand.name}.`,
      heading: `Your project page with ${brand.name}`,
      paragraphs: [
        input.recipientName.trim() ? `Hello ${input.recipientName.trim()},` : "Hello,",
        `${brand.name} set up a page where you can follow ${input.projectName}: progress, decisions, payments and documents.`,
        `Sign in with your mobile number ending in ${input.phoneHint}. ${code}`,
      ],
      action: { label: "Open your project page", url: input.inviteUrl },
      footnote: `This link is for you and expires on ${expiresOn}. You can always sign in at ${input.portalUrl}.`,
    });
    return this.send({ to: input.to, subject: `Your project page with ${brand.name}`, text, html, fromName: brand.name });
  }

  /** A client portal code by email (to sign in, or to confirm a decision), in the tenant's brand. */
  async sendPortalCode(input: { workspaceId: string; to: string; code: string; purpose: "sign_in" | "decision" }): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: input.workspaceId });
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: `${input.code} is your ${brand.name} code.`,
      heading: input.purpose === "sign_in" ? "Your sign-in code" : "Your confirmation code",
      paragraphs: [
        input.purpose === "sign_in" ? `Enter this code to open your project page with ${brand.name}:` : "Enter this code to confirm your decision:",
        input.code,
      ],
      footnote: "The code works once and expires in 5 minutes. If you didn't ask for it, you can ignore this email.",
    });
    return this.send({ to: input.to, subject: `${input.code} is your ${brand.name} code`, text, html, fromName: brand.name });
  }

  /** R8: a signing link for a proposal (or a change request), in the tenant's brand. */
  async sendSignatureRequest(input: { workspaceId: string; to: string; signerName: string; documentTitle: string; reference: string; signUrl: string; expiresAt: Date }): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: input.workspaceId });
    const expiresOn = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(input.expiresAt);
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: `${brand.name} sent ${input.reference} for your signature.`,
      heading: `${input.reference} is ready to sign`,
      paragraphs: [
        input.signerName.trim() ? `Hello ${input.signerName.trim()},` : "Hello,",
        `${brand.name} sent you ${input.documentTitle} (${input.reference}). Read it and sign it online; no account is needed.`,
      ],
      action: { label: "Review and sign", url: input.signUrl },
      footnote: `This link is for you alone and works until ${expiresOn}. If you didn't expect it, you can ignore this email.`,
    });
    return this.send({ to: input.to, subject: `Please sign ${input.reference} · ${brand.name}`, text, html, fromName: brand.name });
  }

  /** R8: the signer's copy of what they signed, with its certificate page. */
  async sendSignedCopy(input: { workspaceId: string; to: string; signerName: string; documentTitle: string; reference: string; copyUrl: string; sha256: string }): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: input.workspaceId });
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: `You signed ${input.reference}.`,
      heading: "Thank you for signing",
      paragraphs: [
        input.signerName.trim() ? `Hello ${input.signerName.trim()},` : "Hello,",
        `You signed ${input.documentTitle} (${input.reference}). ${brand.name} has been told.`,
        `Document fingerprint (SHA-256): ${input.sha256}`,
      ],
      action: { label: "Download your signed copy", url: input.copyUrl },
    });
    return this.send({ to: input.to, subject: `Signed: ${input.reference} · ${brand.name}`, text, html, fromName: brand.name });
  }

  /** The address the platform mailer sends from (MAILGUN_FROM or SES_FROM), or null when email is not set up. */
  senderAddress(): string | null {
    const provider = this.provider();
    if (!provider) return null;
    const configured = this.config.get<string>(provider === "ses" ? "SES_FROM" : "MAILGUN_FROM", "").trim();
    const address = configured.match(/<([^>]+)>/)?.[1] ?? configured;
    return (address || (provider === "mailgun" ? `postmaster@${this.config.get<string>("MAILGUN_DOMAIN", "").trim()}` : "")).toLowerCase() || null;
  }

  /**
   * A team member's reply in an email conversation, in the tenant's brand: from the tenant's name on the platform
   * sending address, with Reply-To on the workspace's inbound address and the threading headers, so the client's
   * answer lands back in the same conversation.
   */
  async sendConversationReply(input: { workspaceId: string; to: string; subject: string; body: string; replyTo: string; headers: NonNullable<TransactionalMessage["headers"]>; attachments?: EmailAttachment[] }, options: EmailSendOptions = {}): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: input.workspaceId });
    const paragraphs = input.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const { html, text } = renderBrandedEmail({ brand, preheader: paragraphs[0]?.slice(0, 140) ?? input.subject, paragraphs });
    return this.send({ to: input.to, subject: input.subject, text, html, fromName: brand.name, replyTo: fromHeader(brand.name.replace(/["<>\r\n]/g, "").trim() || "Inbox", input.replyTo),
      headers: input.headers, ...(input.attachments?.length ? { attachments: input.attachments } : {}) }, options);
  }

  /**
   * Sends one message through the configured provider, after taking a slot of the process-wide send limit. A send
   * that can't get a slot before `options.notAfter` (default: 30 seconds from now) isn't attempted (`deferred`).
   * Provider throttling, provider errors, timeouts and network errors come back `retryable`; a throttle also pauses
   * every send of this process for the provider's Retry-After (at most a minute).
   */
  async send(message: TransactionalMessage, options: EmailSendOptions = {}): Promise<EmailDeliveryResult> {
    // Local and UAT: nothing leaves for a recipient who isn't on DELIVERY_ALLOWLIST.
    if (!deliveryAllowlist(this.config).allowsEmail(message.to)) {
      this.logger.warn(`Transactional email suppressed (${NOT_ALLOWLISTED}) for a recipient at ${message.to.split("@").pop() ?? "unknown"}`);
      return { status: "not_configured", provider: null, messageId: null, suppressedReason: NOT_ALLOWLISTED };
    }
    const provider = this.provider();
    if (!provider) return { status: "not_configured", provider: null, messageId: null };
    const slot = await this.limiter.acquire(options.notAfter ?? Date.now() + EMAIL_SEND_MAX_WAIT_MS);
    if (!slot.granted) {
      this.logger.warn(`Transactional email deferred: the send limit has no slot for ${Math.ceil(slot.retryAfterMs / 1000)}s`);
      return { status: "failed", provider, messageId: null, errorCode: "EMAIL_RATE_LIMITED", retryable: true, retryAfterMs: slot.retryAfterMs, deferred: true };
    }
    return provider === "ses" ? this.sendWithSes(message) : this.sendWithMailgun(message);
  }

  /** A provider failure as a result; a throttle also holds every send of this process back for a moment. */
  private failed(provider: EmailProvider, failure: ProviderFailure): EmailDeliveryResult {
    if (failure.throttled) this.limiter.pause(Math.min(failure.retryAfterMs ?? PROVIDER_THROTTLE_PAUSE_MS, PROVIDER_THROTTLE_PAUSE_CAP_MS));
    return {
      status: "failed", provider, messageId: null, errorCode: failure.errorCode,
      ...(failure.retryable ? { retryable: true } : {}),
      ...(failure.retryable && failure.retryAfterMs !== undefined ? { retryAfterMs: failure.retryAfterMs } : {}),
    };
  }

  private async sendWithMailgun(message: TransactionalMessage): Promise<EmailDeliveryResult> {
    const apiKey = this.config.get<string>("MAILGUN_API_KEY", "").trim();
    const domain = this.config.get<string>("MAILGUN_DOMAIN", "").trim();

    const baseUrl = this.config
      .get<string>("MAILGUN_BASE_URL", DEFAULT_MAILGUN_BASE_URL)
      .replace(/\/+$/, "");
    const configured = this.config.get<string>("MAILGUN_FROM", "").trim();
    const address = configured.match(/<([^>]+)>/)?.[1] ?? (configured || `postmaster@${domain}`);
    const displayName = (message.fromName ?? configured.replace(/\s*<[^>]+>\s*$/, "") ?? "").replace(/["<>\r\n]/g, "").trim() || "Wodana";
    const from = fromHeader(displayName, address);
    const form = new FormData();
    form.set("from", from);
    form.set("to", message.to);
    form.set("subject", message.subject);
    form.set("text", message.text);
    form.set("html", message.html);
    for (const file of message.attachments ?? []) form.append("attachment", new Blob([typeof file.content === "string" ? file.content : Buffer.from(file.content)], { type: file.contentType }), file.filename);
    if (message.replyTo) form.set("h:Reply-To", headerValue(message.replyTo));
    for (const [name, value] of Object.entries(threadingHeaders(message.headers))) form.set(`h:${name}`, value);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v3/${encodeURIComponent(domain)}/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      this.logger.error(`Mailgun transactional email delivery failed (${error instanceof Error ? error.name : "UnknownError"}); it will be retried`);
      return this.failed("mailgun", mailgunTransportFailure(error));
    }
    if (!response.ok) {
      const failure = mailgunFailure(response.status, response.headers?.get?.("retry-after") ?? null);
      const retry = failure.retryable ? `; it will be retried${failure.retryAfterMs !== undefined ? ` (Retry-After ${Math.ceil(failure.retryAfterMs / 1000)}s)` : ""}` : "";
      if (failure.throttled) this.logger.warn(`Mailgun throttled a transactional email with HTTP ${response.status}${retry}`);
      else this.logger.error(`Mailgun rejected a transactional email with HTTP ${response.status}${retry}`);
      return this.failed("mailgun", failure);
    }

    const payload = await response.json().catch(() => ({})) as { id?: unknown };
    const messageId = typeof payload.id === "string" && payload.id.length
      ? payload.id
      : null;
    this.logger.log(`Transactional email accepted by Mailgun${messageId ? ` (${messageId})` : ""}`);
    return { status: "sent", provider: "mailgun", messageId };
  }

  /** Amazon SES: the address is SES_FROM's (a verified domain); the display name is the tenant's. */
  private async sendWithSes(message: TransactionalMessage): Promise<EmailDeliveryResult> {
    const configured = this.config.get<string>("SES_FROM", "").trim();
    const address = configured.match(/<([^>]+)>/)?.[1] ?? configured;
    const displayName = (message.fromName ?? configured.replace(/\s*<[^>]+>\s*$/, "")).replace(/["<>\r\n]/g, "").trim() || "Wodana";
    const region = this.config.get<string>("SES_REGION", "").trim() || this.config.get<string>("AWS_REGION", "").trim() || "us-east-1";
    const configurationSet = this.config.get<string>("SES_CONFIGURATION_SET", "").trim() || undefined;
    try {
      const messageId = await this.sesSender({
        region,
        from: fromHeader(displayName, address),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        configurationSet,
        ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        ...(message.replyTo ? { replyTo: headerValue(message.replyTo) } : {}),
        ...(message.headers ? { headers: threadingHeaders(message.headers) } : {}),
      });
      this.logger.log(`Transactional email accepted by SES${messageId ? ` (${messageId})` : ""}`);
      return { status: "sent", provider: "ses", messageId };
    } catch (error) {
      const failure = sesFailure(error);
      this.logger.error(`SES transactional email delivery failed (${error instanceof Error ? error.name : "UnknownError"})${failure.retryable ? "; it will be retried" : ""}`);
      return this.failed("ses", failure);
    }
  }
}
