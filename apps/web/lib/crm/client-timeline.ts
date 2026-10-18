import type { ActivityItem } from "@/design-system";
import type { ClientTimelineEvent } from "@wodana/contracts";
import { translateKnown, translatorFor, type Translate } from "@/lib/i18n/keys";
import { contactOutcomeLabel } from "./contact";

/** How the timeline reads: the person's translator and the workspace's locale and time zone (from `useDesignSystem()`). */
export type ClientTimelineFormat = { t?: Translate; locale?: string; timeZone?: string };

function eventDate(value: string, t: Translate, format: ClientTimelineFormat) {
  if (!Number.isFinite(Date.parse(value))) return t("Date unavailable");
  return new Intl.DateTimeFormat(format.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: format.timeZone,
  }).format(new Date(value));
}

/** A stored code ("phone", "inbound") as a word people read ("Phone", "Inbound"). */
const word = (value: string, t: Translate) => translateKnown(t, value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase()));

export function clientTimelineItems(events: ClientTimelineEvent[], customerName?: string, format: ClientTimelineFormat = {}): ActivityItem[] {
  const t = format.t ?? translatorFor({});
  return events.map((event) => {
    const statusLabel = event.providerStatus === "read"
      ? t("Read")
      : event.providerStatus === "recorded" ? t("Recorded")
      : event.status === "manually_logged" ? t("Logged")
      : word(event.status, t);
    const tone = event.status === "failed" ? "danger" as const
      : event.status === "delivered" ? "success" as const
        : event.status === "queued" ? "warning" as const
          : event.status === "sent" ? "info" as const : "neutral" as const;
    return {
      id: event.id,
      actor: event.actor?.name ?? (event.direction === "inbound" ? customerName ?? t("Client") : event.kind === "message" ? t("System") : t("Team")),
      action: event.title,
      // A logged contact carries its outcome code; it reads as the outcome people chose ("Willing to talk").
      detail: event.detail ? contactOutcomeLabel(event.detail, t) ?? event.detail : undefined,
      occurredAt: eventDate(event.occurredAt, t, format),
      kind: event.kind === "message" ? "comment" as const : event.kind === "portal" ? "approval" as const : "change" as const,
      meta: [word(event.channel, t), word(event.direction, t), ...(event.failureCode ? [t("Failure: {code}", { code: event.failureCode })] : [])],
      status: { label: statusLabel, tone },
    };
  });
}
