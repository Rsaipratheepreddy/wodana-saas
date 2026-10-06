import { describe, expect, it } from "vitest";
import type { CommercialState, Quote } from "@/lib/commercial/types";
import type { ProjectDetail } from "@/lib/project-core/types";
import type { JourneyView } from "./design-workspace";
import type { PreProjectCase } from "./types";
import { caseActivity, caseMoney, caseNextStep, caseOverdue, casePosition, caseTeam, caseTimeline, effectivePhase } from "./case-record";

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
    expect(step("draft").title).toEqual({ key: "Finish quotation Q-{number}", values: { number: 1 } });
    expect(step("internal_review").title.key).toBe("Review quotation Q-{number}");
    expect(step("internal_approved").title.key).toBe("Send quotation Q-{number} to the client");
    expect(step("issued")).toMatchObject({ title: { key: "Waiting for the client's decision" }, due: "2026-10-10", overdue: false });
    expect(caseNextStep({ record, commercial: commercial({ quotes: [quote({ status: "issued", validUntil: "2026-10-01" })] }), today }).overdue).toBe(true);
    expect(step("changes_requested")).toMatchObject({ title: { key: "Revise quotation Q-{number}" }, status: "attention" });
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
