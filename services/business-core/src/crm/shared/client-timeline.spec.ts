import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { clientTimelineStatus, queryClientTimeline } from "./client-timeline";

describe("client communication timeline", () => {
  it("keeps provider delivery truth distinct from manually logged work", () => {
    expect(clientTimelineStatus("queued", "outbound")).toBe("queued");
    expect(clientTimelineStatus("read", "outbound")).toBe("delivered");
    expect(clientTimelineStatus("failed", "outbound")).toBe("failed");
    expect(clientTimelineStatus("sent", "internal")).toBe("manually_logged");
  });

  it("combines messages, completed interactions and authenticated portal decisions chronologically", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "message", channel: "whatsapp", direction: "outbound", status: "delivered", subject: "Update", detail: "Ready", occurredAt: new Date("2026-09-18T09:00:00Z"), actorId: "user", actorName: "Asha", failureCode: null, conversationId: "conversation" }] })
      .mockResolvedValueOnce({ rows: [{ id: "call", type: "call", direction: "outbound", title: "Client call", description: null, outcome: "Confirmed", occurredAt: new Date("2026-09-18T08:00:00Z"), actorId: "user", actorName: "Asha" }] })
      .mockResolvedValueOnce({ rows: [{ id: "decision", action: "approved", note: "Looks good", decisionBy: "Client", occurredAt: new Date("2026-09-18T10:00:00Z"), caseId: "case" }] });
    const events = await queryClientTimeline({ query } as unknown as PoolClient, {
      workspaceId: "workspace",
      partyId: "party",
      caseIds: ["case"],
      includeMessages: true,
      includeActivities: true,
    });
    expect(events.map((event) => [event.kind, event.status])).toEqual([
      ["portal", "delivered"],
      ["message", "delivered"],
      ["activity", "manually_logged"],
    ]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("does not query communication sources hidden by role", async () => {
    const query = vi.fn();
    await expect(queryClientTimeline({ query } as unknown as PoolClient, {
      workspaceId: "workspace",
      partyId: "party",
      includeMessages: false,
      includeActivities: false,
    })).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
