/**
 * The delivery safety guard for local and UAT environments (DELIVERY_ALLOWLIST): a comma list of exact
 * email addresses, `*@domain` patterns and E.164 phone numbers. When it is set, every external delivery
 * (email, WhatsApp, push) to anyone not on the list is suppressed with the reason `not_allowlisted`.
 * Unset or empty means no guard. Production refuses to start with it set (see runtime-config).
 */
export const NOT_ALLOWLISTED = "not_allowlisted";

const EMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;
const DOMAIN = /^\*@[^@\s,*]+\.[^@\s,*]+$/;
const PHONE = /^\+[1-9]\d{6,14}$/;

export type DeliveryRecipient = { email?: string | null; phone?: string | null };

export class DeliveryAllowlist {
  private constructor(
    readonly enabled: boolean,
    private readonly emails: ReadonlySet<string>,
    private readonly domains: ReadonlySet<string>,
    private readonly phones: ReadonlySet<string>,
  ) {}

  /** Parses the setting; throws on an entry that is none of the three forms, so a typo can't silently block (or allow) everyone. */
  static parse(raw: string | null | undefined): DeliveryAllowlist {
    const entries = String(raw ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
    const emails = new Set<string>(), domains = new Set<string>(), phones = new Set<string>();
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (DOMAIN.test(lower)) domains.add(lower.slice(2));
      else if (EMAIL.test(lower)) emails.add(lower);
      else if (PHONE.test(entry.replace(/[\s()-]/g, ""))) phones.add(entry.replace(/[\s()-]/g, ""));
      else throw new Error(`DELIVERY_ALLOWLIST entry "${entry}" must be an email address, *@domain or an E.164 phone number (+ and country code)`);
    }
    return new DeliveryAllowlist(entries.length > 0, emails, domains, phones);
  }

  allowsEmail(address: string | null | undefined) {
    if (!this.enabled) return true;
    const email = String(address ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) return false;
    return this.emails.has(email) || this.domains.has(email.slice(email.lastIndexOf("@") + 1));
  }

  allowsPhone(number: string | null | undefined) {
    if (!this.enabled) return true;
    const phone = String(number ?? "").replace(/[\s().-]/g, "");
    return this.phones.has(phone.startsWith("+") ? phone : `+${phone}`);
  }

  /** A recipient passes when any of their addresses is on the list; nothing known about them means suppressed. */
  allows(recipient: DeliveryRecipient) {
    if (!this.enabled) return true;
    return (Boolean(recipient.email) && this.allowsEmail(recipient.email)) || (Boolean(recipient.phone) && this.allowsPhone(recipient.phone));
  }
}

/** Reads the guard from configuration (a ConfigService or a plain record). */
export function deliveryAllowlist(config: { get(key: string): unknown }) {
  const raw = config.get("DELIVERY_ALLOWLIST");
  return DeliveryAllowlist.parse(typeof raw === "string" ? raw : "");
}
