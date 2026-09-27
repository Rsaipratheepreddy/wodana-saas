import { isIP } from "node:net";
import { BadRequestException } from "@nestjs/common";

/** The platform domain every organization signs in under (`<slug>.wodana.ai`) until its own domain is live. */
export const BASE_DOMAIN = "wodana.ai";
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeCustomDomain(value: string): string {
  const hostname = value.trim().toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  if (hostname.length > 253 || labels.length < 2 || labels.some((label) => !DOMAIN_LABEL.test(label))
    || isIP(hostname) !== 0 || hostname === "localhost" || hostname.endsWith(".localhost")
    || hostname === BASE_DOMAIN || hostname.endsWith(`.${BASE_DOMAIN}`)) {
    throw new BadRequestException("Enter a custom domain you control, without a URL or Wodana subdomain.");
  }
  return hostname;
}

export function domainDnsChallenge(hostname: string, value: string) {
  return { type: "TXT" as const, name: `_wodana-verify.${hostname}`, value: `wodana-verify=${value}` };
}

export function txtAnswerMatches(records: string[][], expected: string): boolean {
  return records.some((parts) => parts.join("").trim() === expected);
}
