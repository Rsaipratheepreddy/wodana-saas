import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { ApprovalPoliciesPage } from "./approval-policies";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const policy = (over: Record<string, unknown> = {}) => ({
  id: "p1", kind: "deal_file", name: "Deal File", status: "active", isDefault: true, version: 1, currentVersion: 1, updatedAt: "2026-10-01T00:00:00.000Z",
  currency: null, minAmount: null, ownerAboveAmount: null, escalateAfterHours: null, waiverAllowed: false, resetTolerancePercent: "0", pending: 2,
  steps: [{ position: 1, approverKind: "permission", permissionCode: "commercial.finance.verify", roleCode: null, userId: null, label: "Finance verifies", personName: null },
    { position: 2, approverKind: "permission", permissionCode: "commercial.deal.approve", roleCode: null, userId: null, label: "Deal File approver", personName: null }],
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("Settings → Approvals (E3)", () => {
  it("lists each kind's policies with their amounts, approvers in order and escalation, and who covers whom", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => String(url).includes("delegations")
      ? { canManage: true, viewerId: "u1", delegations: [{ id: "d1", userId: "u2", userName: "Fatima", delegateUserId: "u3", delegateName: "Omar", startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-10-10T00:00:00.000Z", note: "", version: 1, active: true }] }
      : { kinds: ["deal_file"], canManage: true, people: [], roles: [{ code: "owner", name: "Owner" }], policies: [policy(),
        policy({ id: "p2", name: "Large deals", isDefault: false, currency: "AED", minAmount: "500000", ownerAboveAmount: "1000000", escalateAfterHours: 24, pending: 0 })] } })));
    render(<DesignSystemProvider locale="en-US"><ApprovalPoliciesPage workspaceId={WORKSPACE} /></DesignSystemProvider>);
    const table = await screen.findByRole("table", { name: "Deal File" });
    expect(within(table).getByText("All amounts")).toBeInTheDocument();
    expect(within(table).getByText("From AED 500,000.00")).toBeInTheDocument();
    expect(within(table).getByText("Owner from AED 1,000,000.00")).toBeInTheDocument();
    expect(within(table).getByText("After 24 hours")).toBeInTheDocument();
    expect(within(screen.getByRole("table", { name: "Away cover" })).getByText("Covering now")).toBeInTheDocument();
  });
});
