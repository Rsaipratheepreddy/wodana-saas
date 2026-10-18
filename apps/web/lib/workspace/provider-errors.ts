import { tKey, type Translate } from "@/lib/i18n/keys";

/**
 * What a connected provider's failure (Google, Gmail, QuickBooks, WhatsApp…) means for a person, in Wodana's words.
 * A provider's own text ("Token has been expired or revoked.") never reaches the screen: the services send a code, and
 * the code picks the sentence here. One map for the routes, the Calendar, Connections and delivery health.
 */
export type ProviderProblem = "reconnect" | "setup" | "unavailable";

/** The account's access ended (revoked, expired, consent missing): only connecting it again helps. */
const RECONNECT = new Set(["reconnect_required", "credential_missing", "refresh_token_missing", "calendar_read_consent_required", "connection_expired"]);

/** Something to choose or turn on in Connections. */
const SETUP = new Set(["no_calendars_selected", "too_many_calendars", "calendar_not_selected", "calendar_read_only", "google_calendar_read_only", "connection_inactive"]);

const MESSAGES: Record<string, string> = {
  reconnect_required: tKey("This account isn't connected anymore. Reconnect it in Connections."),
  credential_missing: tKey("This account isn't connected anymore. Reconnect it in Connections."),
  refresh_token_missing: tKey("This account isn't connected anymore. Reconnect it in Connections."),
  connection_expired: tKey("This account isn't connected anymore. Reconnect it in Connections."),
  calendar_read_consent_required: tKey("Reconnect Google to let Wodana read its calendar."),
  connection_inactive: tKey("This connection is off. Turn it on in Connections."),
  no_calendars_selected: tKey("Choose a calendar for this account in Connections."),
  too_many_calendars: tKey("Choose at most 20 calendars in Connections."),
  calendar_not_selected: tKey("Choose this calendar in Connections first."),
  calendar_read_only: tKey("This calendar can't be changed from Wodana."),
  google_calendar_read_only: tKey("This calendar can't be changed from Wodana."),
  event_changed: tKey("This event changed in Google. Refresh and try again."),
  provider_rate_limited: tKey("The provider is busy. Try again in a minute."),
};

/** Codes the Google client raises for a failed Google call: Google's reason is in the service's log, not here. */
const GOOGLE_CALL_FAILED = /^(oauth_[a-z_]+|userinfo_failed|calendar_[a-z_]+_failed|calendar_discovery_failed|calendar_pagination_limit|event_[a-z]+_failed|freebusy_failed|sheet_read_failed)$/;

export const PROVIDER_UNAVAILABLE = tKey("The provider couldn't complete this. Try again in a moment.");

/** The code in an error payload: `{ code }` (Wodana routes) or `{ error: { code } }` (the integration service). */
export function providerErrorCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as { code?: unknown; error?: { code?: unknown } | unknown };
  const code = typeof record.code === "string" ? record.code : record.error && typeof record.error === "object" ? (record.error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(code) ? code : undefined;
}

export function providerProblem(code: string | undefined): ProviderProblem {
  if (code && RECONNECT.has(code)) return "reconnect";
  if (code && SETUP.has(code)) return "setup";
  return "unavailable";
}

/** Whether the code has a sentence of its own here. */
export function knownProviderError(code: string | undefined) {
  return Boolean(code && MESSAGES[code]);
}

/** A failure's sentence in the person's language; a Google call's failure is never told in Google's words. */
export function providerErrorMessage(t: Translate, code: string | undefined, fallback?: string) {
  if (code && MESSAGES[code]) return t(MESSAGES[code] as never);
  if (code && GOOGLE_CALL_FAILED.test(code)) return t(PROVIDER_UNAVAILABLE as never);
  return fallback ?? t(PROVIDER_UNAVAILABLE as never);
}
