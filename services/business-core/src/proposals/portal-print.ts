import { Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * §0.3 P4, one renderer: the proposal's quotation pages are printed from the client's own portal page (the same
 * component and the same data the portal shows), so the PDF a client signs is the design they read. A headless Chrome
 * opens the portal's print page with a short-lived link bound to exactly one quotation snapshot and saves it as PDF.
 *
 * Switched on with PROPOSAL_PDF_PRINTER=browser (the browser is the installed Chrome unless PROPOSAL_PDF_BROWSER names
 * another Playwright channel). Off, or when printing fails, the built-in composer draws the pages: sending never waits
 * on a browser.
 */
export type PrintTarget = { workspaceId: string; caseId: string; quoteId: string; quoteHash: string | null; slug: string };
export type QuotationPrinter = (target: PrintTarget) => Promise<Uint8Array>;

const PRINT_LINK_MS = 3 * 60_000;
const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** The secret print links are signed with: the portal's code secret, else the staff sign-in secret. */
export const printSecret = (env: NodeJS.ProcessEnv = process.env) => env.PORTAL_OTP_SECRET || env.LOCAL_AUTH_JWT_SECRET || "";

/** A link to print one quotation snapshot, valid for three minutes. */
export function printToken(secret: string, target: PrintTarget, now = Date.now()) {
  const body = b64(JSON.stringify({ ...target, exp: now + PRINT_LINK_MS }));
  return `${body}.${b64(createHmac("sha256", secret).update(body).digest())}`;
}

/** What a print link names, or null when it is forged, altered or expired. */
export function readPrintToken(secret: string, token: string, now = Date.now()): PrintTarget | null {
  if (!secret || typeof token !== "string" || token.length > 2000) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as PrintTarget & { exp: number };
    if (typeof value.exp !== "number" || value.exp < now) return null;
    return { workspaceId: value.workspaceId, caseId: value.caseId, quoteId: value.quoteId, quoteHash: value.quoteHash ?? null, slug: value.slug };
  } catch { return null; }
}

/** The headless-Chrome printer, when the workspace's server is set to print proposals from the portal page. */
export function browserPrinter(env: NodeJS.ProcessEnv = process.env): QuotationPrinter | null {
  if (env.PROPOSAL_PDF_PRINTER !== "browser") return null;
  const secret = printSecret(env);
  if (!secret) return null;
  const origin = (env.WEB_ORIGIN ?? "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
  return async (target) => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.launch({ channel: env.PROPOSAL_PDF_BROWSER || "chrome", headless: true });
    try {
      const page = await browser.newPage();
      const url = `${origin}/portal/${encodeURIComponent(target.slug)}/print?${new URLSearchParams({ token: printToken(secret, target) })}`;
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      if (!response?.ok()) throw new Error(`The portal's print page answered ${response?.status() ?? "nothing"}.`);
      await page.waitForSelector("[data-print-ready]", { timeout: 15_000 });
      await page.emulateMedia({ media: "print" });
      return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    } finally {
      await browser.close();
    }
  };
}

const logger = new Logger("ProposalPrint");

/** The printed quotation pages, or null (printing off or failed: the caller draws them itself). */
export async function printQuotation(printer: QuotationPrinter | null, target: PrintTarget): Promise<Uint8Array | null> {
  if (!printer) return null;
  try {
    const bytes = await printer(target);
    return Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-" ? bytes : null;
  } catch (error) {
    logger.warn(`Printing the quotation from the portal page failed; the built-in pages are used. ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
