import type { ActivityItem } from "@/design-system";
import type { ClientTimelineEvent } from "@wodana/contracts";

function eventDate(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
}

export function clientTimelineItems(events: ClientTimelineEvent[], customerName = "Client"): ActivityItem[] {
  return events.map((event) => {
    const statusLabel = event.providerStatus === "read"
      ? "Read"
      : event.providerStatus === "recorded" ? "Recorded"
      : event.status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    const tone = event.status === "failed" ? "danger" as const
      : event.status === "delivered" ? "success" as const
        : event.status === "queued" ? "warning" as const
          : event.status === "sent" ? "info" as const : "neutral" as const;
    return {
      id: event.id,
      actor: event.actor?.name ?? (event.direction === "inbound" ? customerName : event.kind === "message" ? "System" : "Team"),
      action: event.title,
      detail: event.detail ?? undefined,
      occurredAt: eventDate(event.occurredAt),
      kind: event.kind === "message" ? "comment" as const : event.kind === "portal" ? "approval" as const : "change" as const,
      meta: [event.channel.replaceAll("_", " "), event.direction.replaceAll("_", " "), ...(event.failureCode ? [`Failure: ${event.failureCode}`] : [])],
      status: { label: statusLabel, tone },
    };
  });
}
