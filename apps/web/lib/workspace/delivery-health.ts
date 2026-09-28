import { tKey, type Translate } from "@/lib/i18n/keys";

/** Business Core's delivery health (GET /workspaces/:id/delivery-health). */
export type DeliveryChannel = "email" | "whatsapp" | "push";
export type ChannelHealth = {
  channel: DeliveryChannel;
  configured: boolean;
  teamEmail?: boolean;
  clientEmail?: boolean;
  connection?: string | null;
  devices?: number;
  lastSuccessAt: string | null;
  lastFailure: { at: string; code: string; message: string | null } | null;
  queued24h: number;
  failed24h: number;
  waiting: number;
  oldestWaitingAt: string | null;
};
export type DeliveryHealth = {
  generatedAt: string;
  worker: { status: "ok" | "stale" | "not-reporting" | "unknown"; lastSeenAt: string | null; delivery: string | null };
  allowlist: boolean;
  channels: ChannelHealth[];
  attention: { reason: "worker" | "backlog" | null; since: string | null };
};

export const CHANNEL_LABELS: Record<DeliveryChannel, string> = {
  email: tKey("Email"),
  whatsapp: tKey("WhatsApp"),
  push: tKey("Push"),
};

/** Plain words for a failure code (provider codes, suppression reasons). Unknown codes fall back to the provider's message. */
const FAILURE_REASONS: Record<string, string> = {
  destination_missing: tKey("No address or phone on file"),
  email_not_configured: tKey("Email sending isn't set up"),
  not_allowlisted: tKey("Not on this test environment's allowlist"),
  EMAIL_PROVIDER_UNCONFIGURED: tKey("No email connection"),
  WHATSAPP_PROVIDER_UNCONFIGURED: tKey("No WhatsApp connection"),
  PUSH_PROVIDER_UNCONFIGURED: tKey("Push isn't set up"),
  MAILGUN_TIMEOUT: tKey("The email service didn't answer"),
  MAILGUN_UNREACHABLE: tKey("The email service couldn't be reached"),
  MAILER_ERROR: tKey("The email service couldn't be reached"),
  EMAIL_SEND_FAILED: tKey("The email service refused the message"),
  DeviceNotRegistered: tKey("The phone is no longer registered"),
  PUSH_DESTINATION_INVALID: tKey("The phone is no longer registered"),
  PUSH_PROVIDER_UNAVAILABLE: tKey("The push service didn't answer"),
  PUSH_RECEIPT_UNAVAILABLE: tKey("The push service didn't answer"),
  MessageRateExceeded: tKey("Too many pushes to one phone"),
  InvalidCredentials: tKey("The app's push credentials were refused"),
  PROVIDER_DELIVERY_FAILED: tKey("The provider refused the message"),
};

export function failureReason(t: Translate, failure: ChannelHealth["lastFailure"]) {
  if (!failure) return "";
  if (FAILURE_REASONS[failure.code]) return t(FAILURE_REASONS[failure.code] as never);
  if (/^MAILGUN_HTTP_(401|403)$/.test(failure.code)) return t("The email service refused the sending credentials");
  if (/^MAILGUN_HTTP_/.test(failure.code)) return t("The email service refused the message");
  return failure.message?.trim() || failure.code;
}

export type ChannelState = "working" | "failing" | "waiting" | "not-set-up";

/**
 * One word for a channel: not set up; failing (its last attempt failed, or nothing goes out while the
 * worker is down); waiting (a backlog is building); or working.
 */
export function channelState(channel: ChannelHealth, health: Pick<DeliveryHealth, "worker">): ChannelState {
  if (!channel.configured) return "not-set-up";
  const lastFailure = channel.lastFailure ? Date.parse(channel.lastFailure.at) : 0;
  const lastSuccess = channel.lastSuccessAt ? Date.parse(channel.lastSuccessAt) : 0;
  if (health.worker.status === "stale" || health.worker.status === "not-reporting") return channel.waiting ? "failing" : "waiting";
  if (lastFailure > lastSuccess) return "failing";
  if (channel.waiting && channel.oldestWaitingAt && Date.now() - Date.parse(channel.oldestWaitingAt) > 10 * 60_000) return "waiting";
  return "working";
}

/** The next step for the owner, or null when the channel needs nothing. */
export function nextStep(t: Translate, channel: ChannelHealth, state: ChannelState): { text: string; href?: string } | null {
  if (channel.channel === "email") {
    if (!channel.teamEmail) return { text: t("Email isn't set up. Ask support to turn on email sending.") };
    if (state === "failing") return { text: t("Send yourself a test. If it doesn't arrive, contact support.") };
    if (!channel.clientEmail) return { text: t("Connect Google Workspace to email clients from Sales."), href: "/workspace/integrations" };
    return null;
  }
  if (channel.channel === "whatsapp") {
    if (!channel.configured) return { text: channel.connection ? t("Reconnect WhatsApp in Integrations.") : t("Connect WhatsApp in Integrations."), href: "/workspace/integrations" };
    if (state === "failing") return { text: t("Check the WhatsApp connection and its templates in Integrations."), href: "/workspace/integrations" };
    return null;
  }
  if (!channel.configured) return { text: t("Ask your team to sign in on the mobile app and allow notifications.") };
  return null;
}

/** A delivery health answer, or null for anything else (no access, an older core). */
export function asDeliveryHealth(data: unknown): DeliveryHealth | null {
  const value = data as DeliveryHealth | null;
  return value && Array.isArray(value.channels) && value.attention && value.worker ? value : null;
}

/**
 * The bell's one line when notices aren't reaching people: which channel (or every channel, when the
 * delivery service is silent) and since when nothing has been delivered.
 */
export function deliveryAlert(health: DeliveryHealth): { channel: DeliveryChannel | null; since: string | null } | null {
  if (health.worker.status === "stale" || health.worker.status === "not-reporting") return { channel: null, since: health.worker.lastSeenAt };
  const failing = health.channels.find((channel) => channelState(channel, health) === "failing");
  return failing ? { channel: failing.channel, since: failing.lastSuccessAt ?? failing.lastFailure?.at ?? null } : null;
}
