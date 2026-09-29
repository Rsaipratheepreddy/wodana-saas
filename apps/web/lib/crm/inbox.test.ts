import { describe, expect, it } from "vitest";
import { channelName, fillQuickReply, fillTemplate, nextChatId, quickReplyQuery, renderTemplate, snoozePresets, waitingMinutes, waitingParts, windowLeft } from "./inbox";

describe("team inbox helpers", () => {
  it("names a chat's channel the way people write it", () => {
    const t = ((key: string) => `t:${key}`) as Parameters<typeof channelName>[1];
    expect(channelName("whatsapp", t)).toBe("t:WhatsApp");
    expect(channelName("email", t)).toBe("t:Email");
    expect(channelName("web_chat", t)).toBe("t:Web chat");
    expect(channelName(null, t)).toBe("t:Not set");
  });

  it("fills a template from the chat's records and names each value that is missing", () => {
    const template = { positions: [1, 2, 3], variables: [{ position: 1, source: "contact.first_name" as const }, { position: 2, source: "quote.number" as const }] };
    const filled = fillTemplate(template, { "contact.first_name": "Noura", "quote.number": null });
    expect(filled.parameters).toEqual(["Noura", "", ""]);
    expect(filled.missing).toEqual([{ position: 2, source: "quote.number" }, { position: 3, source: null }]);
    expect(renderTemplate("Hi {{1}}, quote {{2}}", filled.parameters)).toBe("Hi Noura, quote {{2}}");
  });

  it("fills quick replies by field name and leaves unknown fields for the person to type", () => {
    expect(fillQuickReply("Hi {{contact.first_name}}, we're at {{business.name}}. {{contact.nickname}}", { "contact.first_name": "Noura", "business.name": "Palm Studio" }))
      .toBe("Hi Noura, we're at Palm Studio. {{contact.nickname}}");
    expect(quickReplyQuery("/addr")).toBe("addr");
    expect(quickReplyQuery("/")).toBe("");
    expect(quickReplyQuery("see /addr")).toBeNull();
  });

  it("reads the wait and the WhatsApp window", () => {
    const now = Date.parse("2026-09-28T12:00:00Z");
    expect(waitingMinutes("2026-09-28T11:18:00Z", now)).toBe(42);
    expect(waitingMinutes(null, now)).toBeNull();
    expect(waitingParts(42)).toEqual({ key: "Waiting {count} m", count: 42 });
    expect(waitingParts(185)).toEqual({ key: "Waiting {count} h", count: 3 });
    expect(waitingParts(3000)).toEqual({ key: "Waiting {count} d", count: 2 });
    expect(windowLeft("2026-09-28T15:00:00Z", now)).toBe(3 * 3_600_000);
    expect(windowLeft("2026-09-28T11:00:00Z", now)).toBe(0);
  });

  it("snoozes to the next working morning in the workspace's own week and time zone", () => {
    // 24 Sep 2026 is a Thursday: a Sunday–Thursday week sends its snooze to Sunday morning.
    const thursdayEvening = new Date("2026-09-24T16:00:00Z");
    const [hour, tomorrow, nextWeek] = snoozePresets({ now: thursdayEvening, timeZone: "Asia/Riyadh", dayStart: "08:30", workingDays: [0, 1, 2, 3, 4] });
    expect(hour.until).toBe("2026-09-24T17:00:00.000Z");
    expect(tomorrow.until).toBe("2026-09-27T05:30:00.000Z");
    expect(nextWeek.until).toBe("2026-09-27T05:30:00.000Z");
    const monday = snoozePresets({ now: new Date("2026-09-28T10:00:00Z"), timeZone: "UTC", workingDays: [1, 2, 3, 4, 5] });
    expect(monday[1].until).toBe("2026-09-29T09:00:00.000Z");
    expect(monday[2].until).toBe("2026-10-05T09:00:00.000Z");
  });

  it("opens the next chat after one is resolved", () => {
    expect(nextChatId(["a", "b", "c"], "b")).toBe("c");
    expect(nextChatId(["a", "b", "c"], "c")).toBe("b");
    expect(nextChatId(["a"], "a")).toBeNull();
  });
});
