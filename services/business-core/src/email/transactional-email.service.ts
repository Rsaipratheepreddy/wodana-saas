import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

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
}

interface WorkspaceInvitationMessage {
  email: string;
  expiresAt: Date;
  invitationToken: string;
  inviterName: string;
  recipientName: string;
  roleCodes: string[];
  workspaceName: string;
}

const DEFAULT_MAILGUN_BASE_URL = "https://api.mailgun.net";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readableRole(code: string): string {
  return code
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

@Injectable()
export class TransactionalEmailService {
  private readonly logger = new Logger(TransactionalEmailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordReset(input: { email: string; resetToken: string; tenantSlug: string }): Promise<EmailDeliveryResult> {
    const origin = this.config.get<string>("WEB_ORIGIN", "http://localhost:3000").split(",")[0].trim();
    const url = new URL("/login", origin);
    url.searchParams.set("reset", input.resetToken);
    url.searchParams.set("tenant", input.tenantSlug);
    return this.send({
      to: input.email,
      subject: "Reset your Wodana password",
      text: `Reset your password: ${url.toString()}\nThis link expires in 30 minutes. If you did not request a reset, you can ignore this email.`,
      html: `<p>Use this secure link to reset your Wodana password.</p><p><a href="${escapeHtml(url.toString())}">Reset password</a></p><p>This link expires in 30 minutes. If you did not request a reset, you can ignore this email.</p>`,
    });
  }

  async sendWorkspaceInvitation(
    invitation: WorkspaceInvitationMessage,
  ): Promise<EmailDeliveryResult> {
    const webOrigin = this.config
      .get<string>("WEB_ORIGIN", "http://localhost:3000")
      .split(",")[0]
      .trim();
    const activationUrl = new URL("/login", webOrigin);
    activationUrl.searchParams.set("invitation", invitation.invitationToken);

    const workspaceName = escapeHtml(invitation.workspaceName);
    const recipientName = escapeHtml(invitation.recipientName);
    const inviterName = escapeHtml(invitation.inviterName);
    const roles = invitation.roleCodes.map(readableRole).join(", ");
    const safeRoles = escapeHtml(roles || "Member");
    const expiresOn = new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(invitation.expiresAt);
    const safeUrl = escapeHtml(activationUrl.toString());

    return this.send({
      to: invitation.email,
      subject: `You have been invited to ${invitation.workspaceName}`,
      text: [
        `Hello ${invitation.recipientName},`,
        "",
        `${invitation.inviterName} invited you to join ${invitation.workspaceName} as ${roles || "Member"}.`,
        `Accept your invitation: ${activationUrl.toString()}`,
        `This secure link expires on ${expiresOn}.`,
      ].join("\n"),
      html: `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f7f7f5;color:#171a18;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">Join ${workspaceName} on Wodana.</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e5e2;border-radius:16px;">
          <tr><td style="padding:32px;">
            <p style="margin:0 0 24px;font-size:15px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">Wodana</p>
            <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;">Join ${workspaceName}</h1>
            <p style="margin:0 0 12px;font-size:16px;line-height:1.6;">Hello ${recipientName},</p>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">${inviterName} invited you to join <strong>${workspaceName}</strong> as ${safeRoles}.</p>
            <p style="margin:0 0 24px;"><a href="${safeUrl}" style="display:inline-block;border-radius:999px;background:#111111;color:#ffffff;padding:12px 20px;text-decoration:none;font-size:15px;font-weight:700;">Accept invitation</a></p>
            <p style="margin:0;color:#606762;font-size:13px;line-height:1.6;">This secure link expires on ${expiresOn}. If you were not expecting this invitation, you can ignore this email.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
    });
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
    const from = this.config.get<string>("MAILGUN_FROM", "").trim()
      || `Wodana <postmaster@${domain}>`;
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
