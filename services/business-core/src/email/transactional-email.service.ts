import { readableOnWhite } from "./readable-colour";
import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { deliveryAllowlist, NOT_ALLOWLISTED } from "../notifications/delivery-allowlist";
import { renderBrandedEmail, WODANA_BRAND, type EmailBrand } from "./branded-email";

export type EmailDeliveryStatus = "sent" | "not_configured" | "failed";

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  provider: "mailgun" | null;
  messageId: string | null;
  /** Why nothing was sent although email is set up (the DELIVERY_ALLOWLIST guard). */
  suppressedReason?: typeof NOT_ALLOWLISTED;
}

interface TransactionalMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Sender display name, normally the tenant; the address stays the configured sending domain. */
  fromName?: string;
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

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly database?: DatabaseService,
  ) {}

  private origin() {
    return this.config.get<string>("WEB_ORIGIN", "http://localhost:3000").split(",")[0].trim();
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
    const url = new URL("/login", this.origin());
    url.searchParams.set("reset", input.resetToken);
    url.searchParams.set("tenant", input.tenantSlug);
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
    const signIn = new URL("/login", this.origin());
    if (brand.loginSlug) signIn.searchParams.set("tenant", brand.loginSlug);
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
    const activationUrl = new URL("/login", this.origin());
    if (brand.loginSlug) activationUrl.searchParams.set("tenant", brand.loginSlug);
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
  async sendStaffNotice(input: { workspaceId: string; to: string; subject: string; body: string; deepLink?: string | null; actionLabel?: string }): Promise<EmailDeliveryResult> {
    const brand = await this.brand({ workspaceId: input.workspaceId });
    const paragraphs = input.body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
    const url = input.deepLink ? new URL(input.deepLink, this.origin()).toString() : null;
    const { html, text } = renderBrandedEmail({
      brand,
      preheader: input.subject,
      heading: input.subject,
      paragraphs,
      ...(url ? { action: { label: input.actionLabel ?? "Open in workspace", url } } : {}),
    });
    return this.send({ to: input.to, subject: input.subject, text, html, fromName: brand.name });
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

  async send(message: TransactionalMessage): Promise<EmailDeliveryResult> {
    // Local and UAT: nothing leaves for a recipient who isn't on DELIVERY_ALLOWLIST.
    if (!deliveryAllowlist(this.config).allowsEmail(message.to)) {
      this.logger.warn(`Transactional email suppressed (${NOT_ALLOWLISTED}) for a recipient at ${message.to.split("@").pop() ?? "unknown"}`);
      return { status: "not_configured", provider: null, messageId: null, suppressedReason: NOT_ALLOWLISTED };
    }
    const apiKey = this.config.get<string>("MAILGUN_API_KEY", "").trim();
    const domain = this.config.get<string>("MAILGUN_DOMAIN", "").trim();
    if (!apiKey || !domain) {
      return { status: "not_configured", provider: null, messageId: null };
    }

    const baseUrl = this.config
      .get<string>("MAILGUN_BASE_URL", DEFAULT_MAILGUN_BASE_URL)
      .replace(/\/+$/, "");
    const configured = this.config.get<string>("MAILGUN_FROM", "").trim();
    const address = configured.match(/<([^>]+)>/)?.[1] ?? (configured || `postmaster@${domain}`);
    const displayName = (message.fromName ?? configured.replace(/\s*<[^>]+>\s*$/, "") ?? "").replace(/["<>\r\n]/g, "").trim() || "Wodana";
    // Quote the display name only when it contains characters that need it (RFC 5322).
    const from = /[(),.:;@[\]\\]/.test(displayName) ? `"${displayName}" <${address}>` : `${displayName} <${address}>`;
    const form = new FormData();
    form.set("from", from);
    form.set("to", message.to);
    form.set("subject", message.subject);
    form.set("text", message.text);
    form.set("html", message.html);

    try {
      const response = await fetch(`${baseUrl}/v3/${encodeURIComponent(domain)}/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        this.logger.error(`Mailgun rejected a transactional email with HTTP ${response.status}`);
        return { status: "failed", provider: "mailgun", messageId: null };
      }

      const payload = await response.json().catch(() => ({})) as { id?: unknown };
      const messageId = typeof payload.id === "string" && payload.id.length
        ? payload.id
        : null;
      this.logger.log(`Transactional email accepted by Mailgun${messageId ? ` (${messageId})` : ""}`);
      return { status: "sent", provider: "mailgun", messageId };
    } catch (error) {
      const reason = error instanceof Error ? error.name : "UnknownError";
      this.logger.error(`Mailgun transactional email delivery failed (${reason})`);
      return { status: "failed", provider: "mailgun", messageId: null };
    }
  }
}
