import { HISTORY_SUBJECTS, HISTORY_VERBS, type HistoryItem } from "@wodana/contracts/history";
import { describe, expect, it } from "vitest";
import en from "@/lib/i18n/en.json";
import { translatorFor } from "@/lib/i18n/keys";
import { historyChanges, historyHref, historyLinkLabel, historySentence, subjectPhrase } from "./format";

const t = translatorFor(en);
const format = { money: (value: string, currency: string) => `${currency} ${value}`, date: (value: string) => `on ${value.slice(0, 10)}` };
const item = (over: Partial<HistoryItem>): HistoryItem => ({
  id: "1", occurredAt: "2026-10-12T09:00:00.000Z", verb: "sent", category: "change", subject: "quotation", reference: "Q-0012 V2",
  actor: { id: "u", name: "Sara", roles: ["sales"], preset: null, kind: "person" }, amount: null, note: null, to: null, changes: [], links: [], ...over,
});

describe("history sentences", () => {
  it("reads every verb about every subject as a sentence from en.json, never a code", () => {
    for (const verb of HISTORY_VERBS) for (const subject of HISTORY_SUBJECTS) {
      const sentence = historySentence(item({ verb, subject, reference: null }), t, format);
      expect(sentence, `${verb} ${subject}`).not.toMatch(/[{}]|_[a-z]|\.v\d/);
      expect(sentence.length).toBeGreaterThan(6);
    }
    // Every key the formatter uses is a label in en.json (so it is translated, not shown as a key).
    for (const subject of HISTORY_SUBJECTS) expect(en).toHaveProperty([subjectPhrase({ subject, reference: null }, (key) => key)]);
  });

  it("says who did what to which record", () => {
    expect(historySentence(item({ to: "Aisha Rahman" }), t, format)).toBe("Sara sent quotation Q-0012 V2 to Aisha Rahman");
    expect(historySentence(item({ verb: "approved", subject: "purchase_order", reference: "PO-2026-00011" }), t, format)).toBe("Sara approved purchase order PO-2026-00011");
    expect(historySentence(item({ verb: "verified", subject: "payment", reference: null, actor: { id: "f", name: "Layla", roles: [], preset: null, kind: "person" },
      amount: { value: "15000.00", currency: "AED" } }), t, format)).toBe("Layla verified the payment of AED 15000.00");
    expect(historySentence(item({ verb: "decided", subject: "design", reference: null, actor: { id: null, name: "Aisha Rahman", roles: [], preset: null, kind: "client" } }), t, format))
      .toBe("Aisha Rahman (client) decided on the design");
    expect(historySentence(item({ verb: "escalated", subject: "enquiry", reference: null, actor: { id: null, name: null, roles: [], preset: null, kind: "system" } }), t, format))
      .toBe("Automation escalated the enquiry");
    expect(historySentence(item({ verb: "expired", reference: null }), t, format)).toBe("The quotation expired");
  });

  it("degrades a verb or subject this page doesn't know to an update of the record", () => {
    expect(historySentence(item({ verb: "teleported" as never, subject: "spaceship" as never, reference: null }), t, format)).toBe("Sara updated the record");
  });

  it("lists known field changes before → after, readable", () => {
    expect(historyChanges(item({ changes: [{ field: "status", before: "open", after: "won" }, { field: "forecast_category", before: "pipeline", after: "best_case" },
      { field: "expectedDate", before: null, after: "2026-11-30" }, { field: "internal_flag_x", before: "a", after: "b" }] }), t, format)).toEqual([
      { field: "Status", before: "Open", after: "Won" }, { field: "Forecast", before: "Pipeline", after: "Best case" }, { field: "Expected date", before: "—", after: "on 2026-11-30" },
    ]);
  });

  it("links related records to their pages", () => {
    expect(historyHref({ type: "project", id: "p" })).toBe("/workspace/projects/p/overview");
    expect(historyHref({ type: "site_report", id: "r", projectId: "p" })).toBe("/workspace/projects/p/site?report=r");
    expect(historyHref({ type: "quotation", id: "q", caseId: "c" })).toBe("/workspace/pre-projects/cases/c/quotations");
    expect(historyHref({ type: "lead", id: "l" })).toBeNull();
    expect(historyLinkLabel({ type: "invoice", id: "i" }, t)).toBe("Open the invoice");
  });
});
