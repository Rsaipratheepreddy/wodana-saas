import { describe, expect, it } from "vitest";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import type { ProjectDetail } from "@/lib/project-core/types";
import type { JourneyView } from "./design-workspace";
import type { PreProjectCase } from "./types";
import { caseActivity, caseLifecycleStep, caseMoney, caseOverdue, casePosition, caseTeam, caseTimeline, effectivePhase } from "./case-record";

const record: PreProjectCase = {
  id: "c1", title: "Villa 12", description: null, status: "active", customerId: "p1", customerName: "Dana Demo", opportunityId: "o1", opportunityStatus: "won",
  leadId: null, leadManagerName: "Olivia", amount: "118000.0000", currencyCode: "AED", createdAt: "2026-09-29T18:01:23Z", updatedAt: "2026-09-29T18:01:23Z",
  phase: "discover", version: 1, ownerMembershipId: "m1", engagementOwnerName: "Olivia", targetDate: null, priority: "normal", riskLevel: "none",
  activatedAt: "2026-09-29T18:01:23Z", holdReason: null, cancellationReason: null, releasedAt: null, canManageLifecycle: true, salesMembershipId: "m1",
};
const quote = (patch: Partial<Quote>): Quote => ({ id: "q1", number: 1, kind: "quotation", status: "draft", title: "Villa 12", currency: "AED", validUntil: "2026-10-10", discount: 0, taxRate: 5,
  terms: "", exclusions: "", lines: [], requestIds: [], paymentTerms: [], createdAt: "2026-09-29T18:01:25Z", total: 73941, ...patch } as Quote);
const commercial = (data: Partial<CommercialState["data"]>): CommercialState => ({
  workspaceId: "w", caseId: "c1", title: "Villa 12", customerName: "Dana Demo", customerEmail: "dana@example.test", customerPhone: "+971501234567", currency: "AED",
  data: { revision: 1, quotes: [], requests: [], agreement: null, payments: [], audit: [], release: null, ...data }, contacts: [], canEdit: true, canApprove: true, canVerifyFinance: true, canRelease: true, canManagePortal: true, portalSlug: "palm",
});
const executed = { quoteId: "q1", reference: "AGR-1", terms: "", evidence: "", status: "executed" as const, executedAt: "2026-09-29T18:01:29Z", acceptedTotal: 73941, currency: "AED" };
const payment = (patch: Record<string, unknown>) => ({ id: "pay1", title: "Advance on signing", amount: 36970.5, dueDate: "", requiredForRelease: true, status: "pending" as const, proof: "", reference: "", ...patch });
const today = "2026-10-06";

describe("the case's own state beside the job's step now (§0.3 P10)", () => {
  it("adds nothing while the case runs: the job's journey says what's next", () => {
    expect(caseLifecycleStep({ record })).toBeNull();
    expect(caseLifecycleStep({ record: { ...record, status: "released", projectId: "p1" }, journey: { journey: null, stages: [], canStart: true, startsAs: "design", timezone: "UTC" } })).toBeNull();
  });

  it("puts a hold or a cancellation first, with its reason and the one way back", () => {
    expect(caseLifecycleStep({ record: { ...record, status: "on_hold", holdReason: "Client travelling" } })).toMatchObject({ title: { key: "On hold" }, why: { text: "Client travelling" }, action: { command: "resume" } });
    expect(caseLifecycleStep({ record: { ...record, status: "cancelled", cancellationReason: "Lost", canManageLifecycle: false } })).toMatchObject({ title: { key: "Planning cancelled" }, action: null });
  });

  it("offers to start the design (or the site visit) once it can start", () => {
    expect(caseLifecycleStep({ record, journey: { journey: null, stages: [], canStart: true, startsAs: "design", timezone: "UTC" } })).toMatchObject({ action: { command: "start_journey", label: { key: "Start design" } } });
    expect(caseLifecycleStep({ record, journey: { journey: null, stages: [], canStart: true, startsAs: "site_and_materials", timezone: "UTC" } })).toMatchObject({ title: { key: "Start the site visit" } });
    const running: JourneyView = { journey: { packageName: "Full design", includedRevisions: 2 }, timezone: "UTC", stages: [] };
    expect(caseLifecycleStep({ record, journey: running })).toBeNull();
  });
});

describe("the case's strip, money and timeline", () => {
  it("moves the phase on from the commercial records", () => {
    expect(effectivePhase(record, commercial({ quotes: [quote({ status: "issued" })] }))).toBe("price");
    expect(casePosition(record, commercial({ quotes: [quote({ status: "accepted" })] }))).toEqual({ position: 5, count: 6 });
    expect(effectivePhase({ phase: "design" }, commercial({ quotes: [quote({ status: "draft" })] }))).toBe("design");
  });

  it("after a design fee's Deal File, the case is in design: nothing is priced, agreed or ready for production yet", () => {
    // Interior design job: the design fee accepted, its agreement signed and paid, its Deal File approved; no main quotation yet.
    const designFee = quote({ id: "fee", round: "design", status: "accepted", decidedAt: "2026-09-29T18:01:28Z", total: 12000 });
    const paid = commercial({ quotes: [designFee], agreement: { ...executed, quoteId: "fee", acceptedTotal: 12000 }, payments: [payment({ status: "verified" })],
      dealFile: { quoteId: "fee" } as CommercialState["data"]["dealFile"] });
    expect(effectivePhase(record, paid)).toBe("design");
    expect(casePosition(record, paid)).toEqual({ position: 3, count: 6 });
    expect(caseTimeline({ record, commercial: paid, today }).map((step) => [step.id, step.state])).toEqual([
      ["discover", "done"], ["define", "done"], ["design", "current"], ["price", "upcoming"], ["agree", "upcoming"], ["release", "upcoming"],
    ]);
    // Before it is accepted, the design fee doesn't move the case; the main quotation then prices it as usual.
    expect(effectivePhase(record, commercial({ quotes: [{ ...designFee, status: "issued" }] }))).toBe("discover");
    const main = commercial({ quotes: [designFee, quote({ id: "main", number: 2, round: "main", status: "issued" })] });
    expect(effectivePhase({ ...record, phase: "design" }, main)).toBe("price");
  });

  it("after the design approval, the case is priced next: the estimate's new draft doesn't send it back to Requirements", () => {
    // The approval hands off to the main estimate: a draft main quotation now follows the accepted design fee.
    const designFee = quote({ id: "fee", round: "design", status: "accepted", decidedAt: "2026-09-29T18:01:28Z", total: 12000 });
    const estimate = commercial({ quotes: [designFee, quote({ id: "main", number: 2, round: "main", status: "draft" })],
      agreement: { ...executed, quoteId: "fee", acceptedTotal: 12000 }, payments: [payment({ status: "verified" })] });
    const approved = { ...record, designApprovedOn: "2026-10-09" };
    expect(effectivePhase(approved, estimate)).toBe("price");
    expect(casePosition(approved, estimate)).toEqual({ position: 4, count: 6 });
    expect(caseTimeline({ record: approved, commercial: estimate, today }).map((step) => [step.id, step.state, step.doneAt ?? null])).toEqual([
      ["discover", "done", null], ["define", "done", null], ["design", "done", "2026-10-09"], ["price", "current", null], ["agree", "upcoming", null], ["release", "upcoming", null],
    ]);
    // Before the approval, the paid design fee keeps the case in design whichever quotation came last.
    expect(effectivePhase(record, estimate)).toBe("design");
  });

  it("ends a design-only job (Full ID) at the design approval: Design complete, nothing priced next", () => {
    const designFee = quote({ id: "fee", round: "design", status: "accepted", decidedAt: "2026-09-29T18:01:28Z", total: 12000 });
    const paid = commercial({ quotes: [designFee], agreement: { ...executed, quoteId: "fee", acceptedTotal: 12000 }, payments: [payment({ status: "verified" })] });
    const complete = { ...record, designApprovedOn: "2026-10-09", designComplete: true };
    expect(effectivePhase(complete, paid)).toBe("design");
  });

  it("adds money exactly: agreed, paid (verified only) and outstanding", () => {
    const money = caseMoney(commercial({ quotes: [quote({ status: "accepted" })], agreement: executed,
      payments: [payment({ status: "verified" }), payment({ id: "p2", amount: 29576.4, status: "verified" }), payment({ id: "p3", amount: 7394.1, status: "proof_submitted" })] }));
    expect(money).toEqual({ currency: "AED", quoted: null, agreed: "73941.00", paid: "66546.90", outstanding: "7394.10", paidShare: 90 });
    expect(caseMoney(commercial({ quotes: [quote({ status: "issued" })] }))).toMatchObject({ quoted: "73941.00", agreed: null, paidShare: null });
    expect(caseMoney(commercial({}))).toBeNull();
  });

  it("counts what is overdue: lapsed quotation and payments owed past their date", () => {
    expect(caseOverdue({ record, commercial: commercial({ quotes: [quote({ status: "issued", validUntil: "2026-10-01" })] }), today })).toBe(1);
    expect(caseOverdue({ record, commercial: commercial({ quotes: [quote({ status: "accepted" })], agreement: executed, payments: [payment({ dueDate: "2026-10-01" }), payment({ id: "x", dueDate: "2026-12-01" })] }), today })).toBe(1);
    expect(caseOverdue({ record: { ...record, status: "released" }, commercial: commercial({ quotes: [quote({ status: "issued", validUntil: "2026-10-01" })] }), today })).toBe(0);
  });

  it("draws the phases with their real dates, then the project", () => {
    const steps = caseTimeline({ record: { ...record, status: "released", phase: "release", releasedAt: "2026-09-29T18:01:59Z", projectId: "p1" },
      commercial: commercial({ quotes: [quote({ status: "accepted", decidedAt: "2026-09-29T18:01:28Z" })], agreement: executed }), today });
    expect(steps.map((step) => [step.id, step.state, step.doneAt ?? null])).toEqual([
      ["discover", "done", null], ["define", "done", null], ["design", "done", null], ["price", "done", "2026-09-29T18:01:28Z"],
      ["agree", "done", "2026-09-29T18:01:29Z"], ["release", "done", "2026-09-29T18:01:59Z"], ["project", "current", null],
    ]);
  });

  it("lists the team once per person with every role, and the client with phone and email", () => {
    const team = caseTeam({ record, commercial: commercial({}), today }, [{ id: "m1", displayName: "Olivia", email: "olivia@example.test" }]);
    expect(team.team).toEqual([{ id: "m1", name: "Olivia", roles: ["Sales", "Case owner"], email: "olivia@example.test" }]);
    expect(team.client).toMatchObject({ name: "Dana Demo", phone: "+971501234567", email: "dana@example.test" });
  });

  it("words the latest commercial steps, newest first, leaving out unknown ones", () => {
    const audit = [
      { id: "a", at: "2026-09-29T18:00:00Z", actor: "Olivia", action: "issue", note: "" },
      { id: "b", at: "2026-09-29T19:00:00Z", actor: "Layla", action: "verify_payment", note: "" },
      { id: "c", at: "2026-09-29T20:00:00Z", actor: "System", action: "internal_tick", note: "" },
    ];
    expect(caseActivity(commercial({ audit })).map((entry) => [entry.id, entry.text.key])).toEqual([["b", "{who} verified a payment"], ["a", "{who} issued the quotation"]]);
  });
});

describe("a case on its path's own line (PLM-121/126)", () => {
  // An in-stock delivery: the job's configuration says quotation, agreement and payment, then fulfilment.
  const stock = { ...record, plan: { source: "path" as const, phases: ["price", "agree", "release"] as PreProjectCase["phase"][], siteVisit: false, design: false, release: "fulfilment" as const } };
  const unstarted: JourneyView = { journey: null, stages: [], canStart: true, startsAs: "site_and_materials", timezone: "UTC" };

  it("goes straight to the quotation: no site visit, no design, no requirements stage", () => {
    expect(effectivePhase(stock)).toBe("price");
    expect(casePosition(stock)).toEqual({ position: 1, count: 3 });
    // Nothing to start: no site visit or design on this path (the job's journey goes to the quotation).
    expect(caseLifecycleStep({ record: stock, journey: unstarted })).toBeNull();
  });

  it("names its stages from the path and releases to fulfilment", () => {
    expect(caseTimeline({ record: stock, today }).map((step) => step.label.key)).toEqual(["Quotation", "Agreement", "Ready for fulfilment"]);
    const accepted = [quote({ status: "accepted", decidedAt: "2026-09-29T18:01:28Z" })];
    expect(effectivePhase(stock, commercial({ quotes: accepted, agreement: executed }))).toBe("release");
  });

  it("calls the design phase the site visit when the path asks for a visit but no design", () => {
    const measured = { ...stock, plan: { ...stock.plan, phases: ["design", "price", "agree", "release"] as PreProjectCase["phase"][], siteVisit: true, release: "production" as const } };
    expect(caseTimeline({ record: measured, today }).map((step) => step.label.key)).toEqual(["Site visit", "Quotation", "Agreement", "Ready for production"]);
    expect(caseLifecycleStep({ record: measured, journey: unstarted })).toMatchObject({ title: { key: "Start the site visit" }, action: { command: "start_journey" } });
  });

  it("keeps every phase for a case without a path plan", () => {
    expect(caseTimeline({ record, today })).toHaveLength(6);
    expect(casePosition(record)).toEqual({ position: 1, count: 6 });
  });
});
