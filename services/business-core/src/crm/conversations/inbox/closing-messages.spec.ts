import { describe, expect, it } from "vitest";
import { metaBodyProblem } from "./whatsapp-starter-pack";
import { endOfWorkingDayAt, normalizeSlaSchedule } from "../../leads/sla-schedule";
import { requirementProblems } from "../../leads/enquiry-problems";
import { closingDueAt, closingProblem, closingTemplate, DEFAULT_CLOSING_TEXTS, renderClosing, unknownClosingFields } from "./closing-messages";

/** Mon–Fri 9:00–18:00 in Dubai (UTC+4): a firm's working hours, read from its settings in the product. */
const week = normalizeSlaSchedule({
  version: 1, mode: "business", timezone: "Asia/Dubai", holidays: ["2026-10-19"], dateOverrides: {},
  weeklyHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map((day) => [day, [{ start: "09:00", end: "18:00" }]])),
});

describe("closing messages (PLM-137)", () => {
  it("fills {{name}} and {{form_link}}, and closes up a sentence when the chat has no name", () => {
    const form = "Hi {{name}}, to take your enquiry forward, please complete this short form: {{form_link}}. Once we receive it, our team will be in touch.";
    expect(renderClosing(form, { name: "Noura", form_link: "https://palm.example.com/f" })).toBe("Hi Noura, to take your enquiry forward, please complete this short form: https://palm.example.com/f. Once we receive it, our team will be in touch.");
    expect(renderClosing("Thank you, {{name}}! Your enquiry is now with our team.", { name: null })).toBe("Thank you! Your enquiry is now with our team.");
    expect(renderClosing("Hi {{name}}, we haven't heard back from you.", {})).toBe("Hi, we haven't heard back from you.");
    expect(unknownClosingFields("Hi {{name}}, {{client}} {{form_link}}")).toEqual(["client"]);
  });

  it("becomes a WhatsApp template Meta accepts: its fields numbered in order, each mapped to the chat's records", () => {
    expect(closingTemplate("Hi {{name}}, please fill {{form_link}} today, {{name}}. Thanks")).toEqual({ body: "Hi {{1}}, please fill {{2}} today, {{1}}. Thanks", sources: ["contact.first_name", "form.link"] });
    for (const text of Object.values(DEFAULT_CLOSING_TEXTS)) {
      const template = closingTemplate(text);
      expect(metaBodyProblem(template.body, template.sources.length), text).toBeNull();
    }
    // A text ending with a field can't be a template: the settings say so before it is submitted.
    const ending = closingTemplate("Please complete the form: {{form_link}}");
    expect(metaBodyProblem(ending.body, ending.sources.length)).toBe("A template can't start or end with a variable");
  });

  it("is offered only after the firm's quiet working hours since our last reply, never over a weekend or a holiday", () => {
    // Our reply on Thursday at 16:00 Dubai: 2 working hours left that day, 1 more on Friday morning.
    expect(closingDueAt(new Date("2026-10-15T12:00:00Z"), 3, week).toISOString()).toBe("2026-10-16T06:00:00.000Z");
    // Friday at 17:00: one hour left; the weekend and Monday's holiday don't count, so Tuesday at 11:00.
    expect(closingDueAt(new Date("2026-10-16T13:00:00Z"), 3, week).toISOString()).toBe("2026-10-20T07:00:00.000Z");
  });

  it("is never offered to a resolved, spam or snoozed chat, nor while the client waits for us", () => {
    const now = new Date("2026-10-20T10:00:00Z");
    const ready = { status: "open", channel: "whatsapp", waitingSince: null, lastReplyAt: new Date("2026-10-16T13:00:00Z"), dueAt: new Date("2026-10-20T07:00:00Z") };
    expect(closingProblem(ready, now)).toBeNull();
    expect(closingProblem({ ...ready, status: "unresolved" }, now)).toBeNull();
    expect(closingProblem({ ...ready, status: "closed" }, now)).toBe("This chat is already resolved.");
    expect(closingProblem({ ...ready, status: "spam" }, now)).toBe("This chat is marked as spam.");
    expect(closingProblem({ ...ready, status: "snoozed" }, now)).toBe("Wake this chat before closing it.");
    expect(closingProblem({ ...ready, waitingSince: new Date("2026-10-20T09:59:00Z") }, now)).toBe("The client is waiting for our reply.");
    expect(closingProblem({ ...ready, lastReplyAt: null, dueAt: null }, now)).toBe("We haven't written to the client yet.");
    expect(closingProblem(ready, new Date("2026-10-20T06:59:00Z"))).toBe("The client still has time to reply.");
  });
});

describe("timeline checks (PLM-155)", () => {
  it("are due by the end of the working day they are asked, or of the next working day after hours", () => {
    expect(endOfWorkingDayAt(new Date("2026-10-15T08:00:00Z"), week).toISOString()).toBe("2026-10-15T14:00:00.000Z");
    // Asked on Friday evening: due Tuesday evening (the weekend and Monday's holiday skipped).
    expect(endOfWorkingDayAt(new Date("2026-10-16T15:00:00Z"), week).toISOString()).toBe("2026-10-20T14:00:00.000Z");
    expect(endOfWorkingDayAt(new Date("2026-10-15T08:00:00Z"), { version: 1, mode: "elapsed" }).toISOString()).toBe("2026-10-16T08:00:00.000Z");
  });

  it("keep the client's target completion required before the intro when the enquiry type asks for it (PLM-096)", () => {
    const facts = { serviceType: "full_id", email: "a@b.co", area: "3000", address: "Villa 4", budgetRange: null, customerType: null, summary: null, team: new Set<string>(), custom: new Set<string>() };
    const context = { rules: { targetCompletion: "book_intro" as const, address: "book_intro" as const }, hidden: new Set<string>(), hasBudgetRanges: false, hasCustomerTypes: false, teamRoles: [] };
    expect(requirementProblems(facts, context, "book_intro").map((problem) => problem.key)).toEqual(["targetCompletion"]);
    expect(requirementProblems({ ...facts, targetCompletion: "2027-01-15" }, context, "book_intro")).toEqual([]);
    // Not needed to convert when the firm asks for it only before the intro.
    expect(requirementProblems(facts, context, "convert")).toEqual([]);
  });
});
