import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { DealApprovalSteps, DealFileInsight } from "./deal-file-insight";

const insight = {
  currency: "AED", agreed: "120000.30", received: "67500.15", outstanding: "52500.15",
  rounds: [{ round: "design" as const, quoteNumber: 2, agreed: "15000.00", received: "15000.00", outstanding: "0.00" }, { round: "main" as const, quoteNumber: 5, agreed: "105000.30", received: "52500.15", outstanding: "52500.15" }],
  nextDue: { title: "Balance before installation", amount: "52500.15", dueDate: "2026-11-30" },
  risks: ["commission_missing" as const, "balance_outstanding" as const],
  sections: [
    { key: "quotation", group: "common" as const, state: "present" as const, href: "/workspace/pre-projects/cases/c/quotations" },
    { key: "commission", group: "common" as const, state: "missing" as const, count: 0, href: null },
    { key: "proof_of_delivery", group: "furniture" as const, state: "open" as const, href: "/workspace/crm/opportunities?record=o" },
  ],
  closing: { event: "delivered" as const, furniturePath: "in_stock_delivery" as const, closed: false, closedAt: null, checks: [{ key: "delivered" as const, done: false, at: null }] },
  proposals: [],
};

describe("Deal File insight (PLM-066 / PLM-102 / PLM-123)", () => {
  it("shows paid, outstanding and next due, the closing event, what to check, and contents linking to live records", () => {
    render(<DesignSystemProvider locale="en-US"><DealFileInsight insight={insight} /></DesignSystemProvider>);
    const money = screen.getByText("Outstanding").closest("div")!;
    expect(money).toHaveTextContent("52,500.15");
    expect(screen.getByText("Next due").closest("div")).toHaveTextContent("Balance before installation");
    expect(screen.getByText("Proposal 1: AED 15,000.00 of AED 15,000.00 paid · Proposal 2: AED 52,500.15 of AED 105,000.30 paid")).toBeInTheDocument();
    expect(screen.getByText("Closes on delivery")).toBeInTheDocument();
    expect(screen.getByText("Check: commission")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Quotation" })).toHaveAttribute("href", "/workspace/pre-projects/cases/c/quotations");
    expect(within(screen.getByRole("link", { name: "Proof of delivery" }).closest("li")!).getByText("In progress")).toBeInTheDocument();
    expect(within(screen.getByText("Commission").closest("li")!).getByText("Missing")).toBeInTheDocument();
  });

  it("PLM-100: lists each person on the deal once, with every role they hold, and the roles nobody fills as not applicable", () => {
    const sara = { membershipId: "m-sara", name: "Sara", email: "sara@example.test" };
    const noor = { membershipId: "m-noor", name: "Noor", email: null };
    // A second Sara (another person with the same name) keeps her own row: people are told apart by id, not by name.
    const otherSara = { membershipId: "m-sara-2", name: "Sara", email: "sara.k@example.test" };
    const team = [
      { role: "account_manager", label: "Sales", member: sara, notApplicable: false },
      { role: "designer", label: "Designer", member: sara, notApplicable: false },
      { role: "design_manager", label: "Design manager", member: noor, notApplicable: false },
      { role: "qs", label: "QS", member: null, notApplicable: true },
      { role: "site_lead", label: "Site lead", member: sara, notApplicable: false },
      { role: "factory_lead", label: "Factory lead", member: noor, notApplicable: false },
      { role: "buyer", label: "Buyer", member: otherSara, notApplicable: false },
    ];
    render(<DesignSystemProvider locale="en-US"><DealFileInsight insight={{ ...insight, team }} /></DesignSystemProvider>);
    const rows = within(screen.getByRole("list", { name: "Team" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Sara")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Sales · Designer · Site lead")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Noor")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Design manager · Factory lead")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Sara")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Buyer")).toBeInTheDocument();
    expect(screen.getByText("Not applicable: QS")).toBeInTheDocument();
  });

  it("says the deal is closed once the records show it", () => {
    render(<DesignSystemProvider locale="en-US"><DealFileInsight insight={{ ...insight, risks: [], closing: { ...insight.closing, closed: true, closedAt: "2026-11-02T10:00:00.000Z", checks: [{ key: "delivered", done: true, at: "2026-11-02T10:00:00.000Z" }] } }} /></DesignSystemProvider>);
    expect(screen.getByText(/^Deal closed · /)).toBeInTheDocument();
    expect(screen.getByText("Nothing missing on this Deal File.")).toBeInTheDocument();
  });

  it("lists the approval steps: who decided, for whom, and who holds the current one (E3)", () => {
    const approval = {
      id: "r", kind: "deal_file", subjectId: "s", title: "Villa", href: null, status: "pending" as const, amount: "1200000", currency: "AED", previousAmount: null,
      policy: { id: "p", versionId: "v", version: 1, name: "Large deals" }, requestedBy: { userId: "u", name: "Sara" }, requestedAt: "2026-10-01T00:00:00.000Z",
      currentStep: 3, stepSince: "2026-10-02T00:00:00.000Z", escalated: false, expiresAt: null, version: 3, waitingFor: ["Omar"],
      steps: [
        { position: 1, label: "Finance verifies", approverKind: "permission" as const, state: "done" as const, decidedBy: "Cover", onBehalfOf: "Fatima", via: "delegate" as const, decidedAt: "2026-10-01T10:00:00.000Z", note: null },
        { position: 2, label: "Deal File approver", approverKind: "permission" as const, state: "done" as const, decidedBy: "Cece", onBehalfOf: null, via: "direct" as const, decidedAt: "2026-10-02T10:00:00.000Z", note: null },
        { position: 3, label: "Owner", approverKind: "role" as const, state: "current" as const, decidedBy: null, onBehalfOf: null, via: null, decidedAt: null, note: null },
      ],
    };
    render(<DesignSystemProvider locale="en-US"><DealApprovalSteps approval={approval} /></DesignSystemProvider>);
    const steps = screen.getByRole("list", { name: "Approval steps" });
    expect(within(steps).getByText(/Cover · for Fatima · as cover/)).toBeInTheDocument();
    expect(within(steps).getByText("Waiting for Omar")).toBeInTheDocument();
  });
});
