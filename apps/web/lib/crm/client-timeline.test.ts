import { describe, expect, it } from "vitest";
import { clientTimelineItems } from "./client-timeline";

describe("client timeline presentation", () => {
  it("shows provider truth and failure evidence without treating a note as sent", () => {
    const items = clientTimelineItems([
      { id: "queued", kind: "message", channel: "email", direction: "outbound", status: "queued", providerStatus: "queued", title: "Quote", detail: null, occurredAt: "2026-09-18T09:00:00Z", actor: null, failureCode: null, source: { type: "conversation", id: "conversation" } },
      { id: "failed", kind: "message", channel: "whatsapp", direction: "outbound", status: "failed", providerStatus: "failed", title: "Reminder", detail: null, occurredAt: "2026-09-18T08:00:00Z", actor: null, failureCode: "provider_rejected", source: { type: "conversation", id: "conversation" } },
      { id: "note", kind: "activity", channel: "internal", direction: "internal", status: "manually_logged", providerStatus: null, title: "Private note", detail: "Call tomorrow", occurredAt: "2026-09-18T07:00:00Z", actor: { id: "user", name: "Asha" }, failureCode: null, source: { type: "activity", id: "activity" } },
    ], "Client");
    expect(items.map((item) => item.status?.label)).toEqual(["Queued", "Failed", "Manually Logged"]);
    expect(items[1].meta).toContain("Failure: provider_rejected");
    expect(items[2]).toMatchObject({ actor: "Asha", detail: "Call tomorrow" });
  });
});
