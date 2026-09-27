import type { ActivityItem } from "@/design-system";
import type { ClientTimelineEvent } from "@wodana/contracts";
import { translateKnown, translatorFor, type Translate } from "@/lib/i18n/keys";

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

export function clientTimelineItems(events: ClientTimelineEvent[], customerName?: string, format: ClientTimelineFormat = {}): ActivityItem[] {
  const t = format.t ?? translatorFor({});
  return events.map((event) => {
    const statusLabel = event.providerStatus === "read"
      ? t("Read")
      : event.providerStatus === "recorded" ? t("Recorded")
      : translateKnown(t, event.status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()));
    const tone = event.status === "failed" ? "danger" as const
      : event.status === "delivered" ? "success" as const
        : event.status === "queued" ? "warning" as const
          : event.status === "sent" ? "info" as const : "neutral" as const;
    return {
      id: event.id,
      actor: event.actor?.name ?? (event.direction === "inbound" ? customerName ?? t("Client") : event.kind === "message" ? t("System") : t("Team")),
      action: event.title,
      detail: event.detail ?? undefined,
      occurredAt: eventDate(event.occurredAt, t, format),
      kind: event.kind === "message" ? "comment" as const : event.kind === "portal" ? "approval" as const : "change" as const,
      meta: [event.channel.replaceAll("_", " "), event.direction.replaceAll("_", " "), ...(event.failureCode ? [t("Failure: {code}", { code: event.failureCode })] : [])],
      status: { label: statusLabel, tone },
    };
  });
}
