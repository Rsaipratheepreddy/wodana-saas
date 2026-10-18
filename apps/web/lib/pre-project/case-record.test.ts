import { describe, expect, it } from "vitest";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import type { ProjectDetail } from "@/lib/project-core/types";
import type { JourneyView } from "./design-workspace";
import type { PreProjectCase } from "./types";
import { caseActivity, caseListStep, caseMoney, caseNextStep, caseOverdue, casePosition, caseTeam, caseTimeline, effectivePhase } from "./case-record";

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

describe("the case's next step", () => {
  it("follows the phase until a quotation exists", () => {
    expect(caseNextStep({ record, today })).toMatchObject({ title: { key: "Capture the requirements" }, owner: "Olivia", action: { label: { key: "Open requirements" }, href: "/workspace/pre-projects/cases/c1/requirements" } });
  });

  it("puts a hold or a cancellation first, with its reason and the one way back", () => {
    expect(caseNextStep({ record: { ...record, status: "on_hold", holdReason: "Client travelling" }, today })).toMatchObject({ title: { key: "On hold" }, why: { text: "Client travelling" }, action: { command: "resume" } });
    expect(caseNextStep({ record: { ...record, status: "cancelled", cancellationReason: "Lost", canManageLifecycle: false }, today })).toMatchObject({ title: { key: "Planning cancelled" }, action: null });
  });

  it("follows the quotation: finish, review, send, wait for the client (overdue once it lapses), revise", () => {
    const step = (status: Quote["status"]) => caseNextStep({ record, commercial: commercial({ quotes: [quote({ status })] }), today });
    expect(step("draft").title).toEqual({ key: "Finish quotation {quote}", values: { quote: "Q-1" } });
    expect(step("internal_review").title.key).toBe("Review quotation {quote}");
    expect(step("internal_approved").title.key).toBe("Send quotation {quote} to the client");
    expect(step("issued")).toMatchObject({ title: { key: "Waiting for the client's decision" }, due: "2026-10-10", overdue: false });
    expect(caseNextStep({ record, commercial: commercial({ quotes: [quote({ status: "issued", validUntil: "2026-10-01" })] }), today }).overdue).toBe(true);
    expect(step("changes_requested")).toMatchObject({ title: { key: "Revise quotation {quote}" }, status: "attention" });
  });

  it("after acceptance: the agreement, then each payment in due order, then the release", () => {
    const accepted = [quote({ status: "accepted", decidedAt: "2026-09-29T18:01:28Z" })];
    expect(caseNextStep({ record, commercial: commercial({ quotes: accepted }), today }).title.key).toBe("Sign the agreement");
    const payments = [payment({ id: "pay2", title: "Before production", dueDate: "2026-11-01" }), payment({ dueDate: "2026-10-01" })];
    expect(caseNextStep({ record, commercial: commercial({ quotes: accepted, agreement: executed, payments }), today }))
      .toMatchObject({ title: { key: "Collect {title}", values: { title: "Advance on signing" } }, overdue: true, action: { href: "/workspace/pre-projects/cases/c1/payment-plan?payment=pay1" } });
    expect(caseNextStep({ record, commercial: commercial({ quotes: accepted, agreement: executed, payments: [payment({ status: "proof_submitted" })] }), today }).title.key).toBe("Verify {title}");
    expect(caseNextStep({ record, commercial: commercial({ quotes: accepted, agreement: executed, payments: [payment({ status: "verified" })] }), today }).title.key).toBe("Release to production");
  });

  it("leads with the design stage being worked on, its owner and its deadline", () => {
    const journey: JourneyView = { journey: { packageName: "Full design", includedRevisions: 2 }, timezone: "Asia/Dubai", stages: [
      { stage: "inspiration", label: "Inspiration", status: "done", ownerName: "Noor", dueAt: null, completedAt: "2026-10-01T10:00:00Z", version: 1, overdue: false },
      { stage: "concepts", label: "Concepts", status: "active", ownerName: "Noor", dueAt: "2026-10-04T10:00:00Z", completedAt: null, version: 1, overdue: true, progress: { total: 3, approved: 1, pending: 2 } },
    ] };
    expect(caseNextStep({ record: { ...record, phase: "design" }, journey, today })).toMatchObject({
      title: { key: "Concepts" }, why: { key: "{approved} of {total} approved" }, owner: "Noor", overdue: true, action: { href: "/workspace/pre-projects/cases/c1/designs?stage=concepts" },
    });
    expect(caseNextStep({ record, journey: { journey: null, stages: [], canStart: true, startsAs: "design", timezone: "UTC" }, today })).toMatchObject({ action: { command: "start_journey" } });
  });

  it("PLM-147: an open value engineering round is the step, led by the lead designer, until the client decides", () => {
    const round = (patch: Record<string, unknown>) => ({ open: { status: "open", step: "agree_options", quoteId: "q1", qsName: "Quinn QS", lead: { membershipId: "m2", name: "Dina", fallback: false }, ...patch } as never });
    const quotes = commercial({ quotes: [quote({ status: "draft" })] });
    expect(caseNextStep({ record: { ...record, phase: "price" }, commercial: quotes, valueEngineering: round({}), today })).toMatchObject({
      title: { key: "Value engineering" }, why: { key: "Agree the savings with {name}", values: { name: "Quinn QS" } }, owner: "Dina",
      action: { label: { key: "Open quotation" }, href: "/workspace/pre-projects/cases/c1/quotations?quote=q1" },
    });
    expect(caseNextStep({ record, commercial: quotes, valueEngineering: round({ step: "present_options" }), today }).why).toEqual({ key: "Present the options to the client" });
    expect(caseNextStep({ record, commercial: quotes, valueEngineering: round({ step: "client_decision" }), today }).why).toEqual({ key: "Waiting for the client's decision" });
    // No round open: the quotation's own step.
    expect(caseNextStep({ record, commercial: quotes, valueEngineering: { open: null }, today }).title.key).toBe("Finish quotation {quote}");
  });

  it("after the release, points to the project and its own next step", () => {
    const project = { project: { id: "p1", reference: "PRJ-0003", status: "active", promiseDate: "2026-10-19" }, stages: [{ id: "s", position: 5, name: "Delivery and installation", status: "current" }],
      next: { text: "Everything delivered and installed", owner: null }, team: [] } as unknown as ProjectDetail;
    expect(caseNextStep({ record: { ...record, status: "released", projectId: "p1" }, project, today })).toMatchObject({
      title: { key: "Everything delivered and installed" }, action: { href: "/workspace/projects/p1" }, due: "2026-10-19",
    });
    expect(caseNextStep({ record: { ...record, status: "released", projectId: "p1" }, project: { ...project, project: { ...project.project, status: "completed" } } as ProjectDetail, today }).title.key).toBe("Project completed");
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
    expect(caseNextStep({ record, commercial: paid, today }).title.key).toBe("Present the design");
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
    expect(caseNextStep({ record: approved, commercial: estimate, today }).title).toEqual({ key: "Finish quotation {quote}", values: { quote: "Q-2" } });
    expect(caseListStep(approved, { data: { quotes: [{ id: "fee", number: 1, kind: "quotation", round: "design", status: "accepted" }, { id: "main", number: 2, kind: "quotation", round: "main", status: "draft" }], agreement: null } }))
      .toEqual({ stage: "Quotation", next: { key: "Finish quotation {quote}", values: { quote: "Q-2" } } });
    // Before the approval, the paid design fee keeps the case in design whichever quotation came last.
    expect(effectivePhase(record, estimate)).toBe("design");
  });

  it("ends a design-only job (Full ID) at the design approval: Design complete, nothing priced next", () => {
    const designFee = quote({ id: "fee", round: "design", status: "accepted", decidedAt: "2026-09-29T18:01:28Z", total: 12000 });
    const paid = commercial({ quotes: [designFee], agreement: { ...executed, quoteId: "fee", acceptedTotal: 12000 }, payments: [payment({ status: "verified" })] });
    const complete = { ...record, designApprovedOn: "2026-10-09", designComplete: true };
    expect(effectivePhase(complete, paid)).toBe("design");
    expect(caseNextStep({ record: complete, commercial: paid, today })).toMatchObject({ title: { key: "Design complete" }, status: "done", action: null });
    expect(caseListStep(complete, { data: { quotes: [{ id: "fee", number: 1, kind: "quotation", round: "design", status: "accepted" }], agreement: null } }).next).toEqual({ key: "Design complete" });
  });

  it("gives the Planning list the overview's reading: a sent quotation waits for the client, an approved one is to send", () => {
    const facts = (status: string) => ({ data: { quotes: [{ id: "q1", number: 1, kind: "quotation", round: "main" as const, status }], agreement: null }, quoteReferences: { q1: "PLM-QUO-2026-00001" } });
    expect(caseListStep({ phase: "price" }, facts("issued"))).toEqual({ stage: "Quotation", next: { key: "Waiting for the client's decision" } });
    expect(caseListStep({ phase: "discover" }, facts("internal_approved"))).toEqual({ stage: "Quotation", next: { key: "Send quotation {quote} to the client", values: { quote: "PLM-QUO-2026-00001" } } });
    expect(caseListStep({ phase: "price" })).toEqual({ stage: "Quotation", next: { key: "Send the quotation" } });
  });

  it("names a sent quotation by the number it was issued under", () => {
    const sent = { ...commercial({ quotes: [quote({ status: "issued" })] }), quoteReferences: { q1: "PLM-QUO-2026-00001" } };
    expect(caseNextStep({ record, commercial: sent, today }).why).toEqual({ key: "Quotation {quote} is with the client", values: { quote: "PLM-QUO-2026-00001" } });
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
    const next = caseNextStep({ record: stock, journey: unstarted, today });
    expect(next).toMatchObject({ title: { key: "Send the quotation" }, action: { label: { key: "Open quotations" }, href: "/workspace/pre-projects/cases/c1/quotations" } });
    expect(JSON.stringify(next)).not.toMatch(/site visit|measuring/i);
  });

  it("names its stages from the path and releases to fulfilment", () => {
    expect(caseTimeline({ record: stock, today }).map((step) => step.label.key)).toEqual(["Quotation", "Agreement", "Ready for fulfilment"]);
    const accepted = [quote({ status: "accepted", decidedAt: "2026-09-29T18:01:28Z" })];
    expect(caseNextStep({ record: stock, commercial: commercial({ quotes: accepted, agreement: executed, payments: [payment({ status: "verified" })] }), today }).title.key).toBe("Release to fulfilment");
    expect(effectivePhase(stock, commercial({ quotes: accepted, agreement: executed }))).toBe("release");
  });

  it("calls the design phase the site visit when the path asks for a visit but no design", () => {
    const measured = { ...stock, plan: { ...stock.plan, phases: ["design", "price", "agree", "release"] as PreProjectCase["phase"][], siteVisit: true, release: "production" as const } };
    expect(caseTimeline({ record: measured, today }).map((step) => step.label.key)).toEqual(["Site visit", "Quotation", "Agreement", "Ready for production"]);
    expect(caseNextStep({ record: measured, journey: unstarted, today })).toMatchObject({ title: { key: "Start the site visit" }, action: { command: "start_journey" } });
  });

  it("keeps every phase for a case without a path plan", () => {
    expect(caseTimeline({ record, today })).toHaveLength(6);
    expect(casePosition(record)).toEqual({ position: 1, count: 6 });
  });
});
