import { describe, expect, it } from "vitest";
import type { RecordData } from "@/lib/crm/client";
import type { ChatEvent } from "@/lib/crm/inbox";
import { chatTimeline } from "./chat-thread";

const message = (id: string, createdAt: string, direction = "inbound") => ({ id, createdAt, direction, bodyText: id, metadata: {} }) as unknown as RecordData;

describe("chat timeline", () => {
  it("reads oldest at the top and newest at the bottom, whatever order the pages arrive in", () => {
    // The API sends the newest page first, newest message first.
    const entries = chatTimeline([message("m3", "2026-10-02T10:02:00.000Z", "outbound"), message("m2", "2026-10-02T10:01:00.000Z"), message("m1", "2026-10-01T09:00:00.000Z")],
      [{ id: "e1", createdAt: "2026-10-02T10:01:30.000Z" } as unknown as ChatEvent]);
    expect(entries.map((entry) => entry.kind === "message" ? entry.message.id : entry.kind === "event" ? entry.event.id : "album")).toEqual(["m1", "m2", "e1", "m3"]);
  });

  it("keeps messages of the same moment in a stable order", () => {
    const at = "2026-10-02T10:00:00.000Z";
    const forward = chatTimeline([message("a", at), message("b", at)], []);
    const backward = chatTimeline([message("b", at), message("a", at)], []);
    expect(forward.map((entry) => entry.kind === "message" && entry.message.id)).toEqual(["a", "b"]);
    expect(backward.map((entry) => entry.kind === "message" && entry.message.id)).toEqual(["a", "b"]);
  });
});
