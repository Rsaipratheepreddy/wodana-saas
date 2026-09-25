/**
 * The one email layout for every tenant message. The tenant's branding record (the same record the
 * sign-in page uses) is the source of truth for the name, logo and accent colour; Wodana appears only
 * as a small "powered by" line.
 */
export type EmailBrand = {
  /** Tenant display name, e.g. "Palm Living". */
  name: string;
  /** Absolute HTTPS (or local development) URL of the tenant logo, or null to show the name. */
  logoUrl: string | null;
  /** Accent for the primary action; always a validated #rrggbb value. */
  accentColor: string;
};

export type BrandedEmail = {
  brand: EmailBrand;
  /** Hidden inbox preview line. */
  preheader: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /** Small print under the action (expiry, "ignore if unexpected"). */
  footnote?: string;
  lang?: string;
  direction?: "ltr" | "rtl";
};

export const WODANA_BRAND: EmailBrand = { name: "Wodana", logoUrl: null, accentColor: "#292d32" };

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Picks black or white text for a solid accent background. */
function onAccent(hex: string) {
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff";
}

export function renderBrandedEmail(email: BrandedEmail): { html: string; text: string } {
  const accent = HEX.test(email.brand.accentColor) ? email.brand.accentColor : WODANA_BRAND.accentColor;
  const direction = email.direction ?? "ltr";
  const align = direction === "rtl" ? "right" : "left";
  const name = escapeHtml(email.brand.name);
  const identity = email.brand.logoUrl
    ? `<img src="${escapeHtml(email.brand.logoUrl)}" alt="${name}" height="40" style="display:block;height:40px;max-width:200px;border:0;">`
    : `<p style="margin:0;font-size:16px;font-weight:700;">${name}</p>`;
  const paragraphs = email.paragraphs
    .map((paragraph) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${escapeHtml(paragraph)}</p>`)
    .join("");
  const action = email.action
    ? `<p style="margin:8px 0 24px;"><a href="${escapeHtml(email.action.url)}" style="display:inline-block;border-radius:8px;background:${accent};color:${onAccent(accent)};padding:12px 20px;text-decoration:none;font-size:15px;font-weight:700;">${escapeHtml(email.action.label)}</a></p>`
    : "";
  const footnote = email.footnote
    ? `<p style="margin:0;color:#606762;font-size:13px;line-height:1.6;">${escapeHtml(email.footnote)}</p>`
    : "";
  const html = `<!doctype html>
<html lang="${escapeHtml(email.lang ?? "en")}" dir="${direction}">
  <body style="margin:0;background:#f7f7f5;color:#171a18;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;">${escapeHtml(email.preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f7f5;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e5e2;border-radius:12px;text-align:${align};">
          <tr><td style="padding:32px;">
            <div style="margin:0 0 24px;">${identity}</div>
            <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;">${escapeHtml(email.heading)}</h1>
            ${paragraphs}${action}${footnote}
          </td></tr>
        </table>
        <p style="margin:16px 0 0;color:#8a908b;font-size:12px;">Powered by Wodana</p>
      </td></tr>
    </table>
  </body>
</html>`;
  const text = [
    email.brand.name,
    "",
    email.heading,
    "",
    ...email.paragraphs,
    ...(email.action ? ["", `${email.action.label}: ${email.action.url}`] : []),
    ...(email.footnote ? ["", email.footnote] : []),
  ].join("\n");
  return { html, text };
}
