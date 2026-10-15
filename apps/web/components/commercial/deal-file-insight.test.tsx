import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { translatorFor } from "@/lib/i18n/keys";
import { DealApprovalSteps, DealClosing, DealMoney, DealRequirements, DealTeam, dealPaidShare, dealRequirementCount, dealRiskText } from "./deal-file-insight";

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
const wrap = (node: React.ReactNode) => render(<DesignSystemProvider locale="en-US">{node}</DesignSystemProvider>);

describe("Deal File sections (PLM-066 / PLM-102 / PLM-123)", () => {
  it("counts the requirements and the paid share, and names only the real risks", () => {
    expect(dealRequirementCount(insight)).toEqual({ done: 1, missing: 1, total: 3 });
    expect(dealPaidShare(insight)).toBe(56);
    const t = translatorFor({});
    expect(dealRiskText(t, insight)).toBe("Check: commission");
    // An outstanding balance is the Money section's, not a risk: nothing to check then.
    expect(dealRiskText(t, { ...insight, risks: ["balance_outstanding"] })).toBeNull();
  });

  it("lists the requirements by group, each a link to its live record with its state as a chip", () => {
    wrap(<DealRequirements id="deal-requirements" insight={insight} />);
    const card = screen.getByRole("region", { name: "Requirements" });
    expect(card).toHaveAttribute("id", "deal-requirements");
    expect(within(card).getByText("1 of 3 done")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Quotation" })).toHaveAttribute("href", "/workspace/pre-projects/cases/c/quotations");
    expect(within(screen.getByRole("link", { name: "Proof of delivery" }).closest("li")!).getByText("In progress")).toBeInTheDocument();
    expect(within(screen.getByText("Commission").closest("li")!).getByText("Missing")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: "Quotation" }).closest("li")!).getByText("Done")).toBeInTheDocument();
    expect(within(card).getByRole("list", { name: "Furniture" })).toBeInTheDocument();
  });

  it("shows paid, outstanding, next due and each proposal's own money, amounts at the end", () => {
    wrap(<DealMoney insight={insight} withAgreed={false} extra={[{ id: "cost", label: "Internal cost", amount: "AED 50.00" }]} />);
    const money = screen.getByRole("region", { name: "Money" });
    expect(within(money).queryByText("Agreed value")).not.toBeInTheDocument();
    expect(screen.getByText("Outstanding").closest("div")).toHaveTextContent("52,500.15");
    expect(screen.getByText("Next due").closest("div")).toHaveTextContent("Balance before installation");
    expect(screen.getByText("Proposal 1 · Design fee").closest("div")).toHaveTextContent("AED 15,000.00 of AED 15,000.00 paid");
    expect(screen.getByText("Proposal 2 · Main quotation").closest("div")).toHaveTextContent("AED 52,500.15 of AED 105,000.30 paid");
    expect(screen.getByText("Internal cost").closest("div")).toHaveTextContent("AED 50.00");
  });

  it("shows the closing event as a checklist, and says the deal is closed once the records show it", () => {
    const { unmount } = wrap(<DealClosing insight={insight} />);
    expect(screen.getByText("Closes on delivery")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Closing" })).getByText("Delivered").closest("li")).not.toHaveAttribute("data-done");
    unmount();
    wrap(<DealClosing insight={{ ...insight, closing: { ...insight.closing, closed: true, closedAt: "2026-11-02T10:00:00.000Z", checks: [{ key: "delivered", done: true, at: "2026-11-02T10:00:00.000Z" }] } }} />);
    expect(screen.getByText(/^Deal closed · /)).toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Closing" })).getByText("Delivered").closest("li")).toHaveAttribute("data-done");
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
    wrap(<DealTeam insight={{ ...insight, team }} />);
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
    wrap(<DealApprovalSteps approval={approval} />);
    const steps = within(screen.getByRole("list", { name: "Approval steps" })).getAllByRole("listitem");
    expect(steps[0]).toHaveAttribute("data-state", "done");
    expect(within(steps[0]).getByText(/Cover · for Fatima · as cover/)).toBeInTheDocument();
    expect(steps[2]).toHaveAttribute("aria-current", "step");
    expect(within(steps[2]).getByText("Waiting for Omar")).toBeInTheDocument();
  });
});
