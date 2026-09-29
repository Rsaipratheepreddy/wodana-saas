import { describe, expect, it } from "vitest";
import { quietFollowUpDue } from "./client-followups";
import { CLIENT_EVENTS } from "./client-messages";
import { templatePlaceholders } from "./inbox-rules";
import { metaBodyProblem, sampleValues, STARTER_LANGUAGES, STARTER_PACK, startersForEvent } from "./whatsapp-starter-pack";

describe("WhatsApp starter pack", () => {
  it("has a template for every client event, unique Meta names, and a richer one first where an event has two", () => {
    expect([...new Set(STARTER_PACK.map((template) => template.event))].sort()).toEqual([...CLIENT_EVENTS].sort());
    expect(new Set(STARTER_PACK.map((template) => template.name)).size).toBe(STARTER_PACK.length);
    for (const template of STARTER_PACK) expect(template.name).toMatch(/^wd_[a-z0-9_]{1,508}$/);
    // Visits with the address before without it; handover with the review link before without it.
    expect(startersForEvent("crm.meeting.booked").map((template) => template.name)).toEqual(["wd_visit_confirmed", "wd_visit_confirmed_time"]);
    expect(startersForEvent("crm.meeting.reminder").map((template) => template.name)).toEqual(["wd_visit_reminder", "wd_visit_reminder_time"]);
    expect(startersForEvent("project.handover_thanks").map((template) => template.name)).toEqual(["wd_handover_review", "wd_handover_thanks"]);
    for (const event of CLIENT_EVENTS) {
      const [first, ...rest] = startersForEvent(event);
      for (const other of rest) expect(first.sources.length).toBeGreaterThan(other.sources.length);
    }
  });

  it("nudges a quiet enquiry after the first gap, then after the longer second one, and never after the client answered", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const once = { quietDays: 3, quietSecondDays: null }, twice = { quietDays: 3, quietSecondDays: 7 };
    expect(quietFollowUpDue({ lastOutboundAt: daysAgo(2), lastInboundAt: null, sent: 0, now, settings: once })).toBeNull();
    expect(quietFollowUpDue({ lastOutboundAt: daysAgo(3), lastInboundAt: daysAgo(5), sent: 0, now, settings: once })).toBe(1);
    expect(quietFollowUpDue({ lastOutboundAt: daysAgo(9), lastInboundAt: null, sent: 1, now, settings: once })).toBeNull();
    expect(quietFollowUpDue({ lastOutboundAt: daysAgo(6), lastInboundAt: null, sent: 1, now, settings: twice })).toBeNull();
    expect(quietFollowUpDue({ lastOutboundAt: daysAgo(7), lastInboundAt: null, sent: 1, now, settings: twice })).toBe(2);
    expect(quietFollowUpDue({ lastOutboundAt: daysAgo(4), lastInboundAt: daysAgo(1), sent: 0, now, settings: once })).toBeNull();
    expect(quietFollowUpDue({ lastOutboundAt: daysAgo(90), lastInboundAt: null, sent: 0, now, settings: once })).toBeNull();
    expect(quietFollowUpDue({ lastOutboundAt: null, lastInboundAt: null, sent: 0, now, settings: once })).toBeNull();
  });

  it.each(STARTER_PACK.flatMap((template) => STARTER_LANGUAGES.map((language) => [template.key, language, template] as const)))("%s (%s) follows Meta's rules and maps every variable", (_key, language, template) => {
    const body = template.bodies[language];
    expect(metaBodyProblem(body, template.sources.length)).toBeNull();
    expect(templatePlaceholders(body)).toEqual(template.sources.map((_source, index) => index + 1));
  });

  it("refuses what Meta would reject", () => {
    expect(metaBodyProblem("{{1}}, your quote is ready", 1)).toMatch(/start or end/);
    expect(metaBodyProblem("Your quote is ready {{1}}", 1)).toMatch(/start or end/);
    expect(metaBodyProblem("Hi {{1}} and {{3}} here", 2)).toMatch(/numbered/);
    expect(metaBodyProblem("Hi {{1}} {{2}} ok", 2)).toMatch(/fixed text/);
  });

  it("gives Meta sample values in the workspace's currency and name", () => {
    const samples = sampleValues(STARTER_PACK.find((template) => template.key === "invoice_issued")!, { businessName: "Palm Studio", currency: "SAR", locale: "ar-SA", webOrigin: "https://studio.example/" });
    expect(samples[0]).toBe("Noura");
    expect(samples[2]).toMatch(/12,?٬?500|١٢٬٥٠٠/);
    expect(samples[3]).toBe("https://studio.example/portal");
  });
});
