import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../database/database.service";
import { renderBrandedEmail, WODANA_BRAND, type EmailBrand } from "./branded-email";

export type EmailDeliveryStatus = "sent" | "not_configured" | "failed";

export interface EmailDeliveryResult {
  status: EmailDeliveryStatus;
  provider: "mailgun" | null;
  messageId: string | null;
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
  recipientName: string;
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
   * and accent. Falls back to Wodana when the tenant has not configured branding.
   */
  async brand(target: { workspaceId?: string; loginSlug?: string }): Promise<EmailBrand & { loginSlug: string | null }> {
    if (!this.database || (!target.workspaceId && !target.loginSlug)) return { ...WODANA_BRAND, loginSlug: null };
    const result = await this.database.query<BrandRow>(
      `SELECT display_name AS "displayName", login_slug AS "loginSlug", logo_url AS "logoUrl",
              logo_asset_id AS "logoAssetId", primary_color AS "primaryColor"
       FROM tenant_login_branding
       WHERE ($1::uuid IS NOT NULL AND workspace_id = $1::uuid) OR ($2::text IS NOT NULL AND login_slug = $2::text)
       LIMIT 1`,
      [target.workspaceId ?? null, target.loginSlug ?? null],
    ).catch(() => ({ rows: [] as BrandRow[] }));
    const row = result.rows[0];
    if (!row) return { ...WODANA_BRAND, loginSlug: target.loginSlug ?? null };
    const logoUrl = row.logoAssetId
      ? new URL(`/api/auth/tenant-logo/${encodeURIComponent(row.loginSlug)}?v=${row.logoAssetId}`, this.origin()).toString()
      : row.logoUrl && /^https:\/\//.test(row.logoUrl) ? row.logoUrl : null;
    return {
      name: row.displayName,
      logoUrl,
      accentColor: row.primaryColor && /^#[0-9a-f]{6}$/i.test(row.primaryColor) ? row.primaryColor : WODANA_BRAND.accentColor,
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
        `Hello ${invitation.recipientName},`,
        `${invitation.inviterName} invited you to join ${invitation.workspaceName} as ${roles}.`,
      ],
      action: { label: "Accept invitation", url: activationUrl.toString() },
      footnote: `This secure link expires on ${expiresOn}. If you were not expecting this invitation, you can ignore this email.`,
    });
    return this.send({ to: invitation.email, subject: `You have been invited to ${invitation.workspaceName}`, text, html, fromName: brand.name });
  }

  async send(message: TransactionalMessage): Promise<EmailDeliveryResult> {
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
