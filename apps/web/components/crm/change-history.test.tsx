import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { ChangeHistory } from "./change-history";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

describe("enquiry change history (PLM-094)", () => {
  it("shows who changed which field from what to what, with owners by name", async () => {
    vi.mocked(crmRequest).mockResolvedValue([
      { id: "e1", action: "crm.lead.reassigned.v1", at: "2026-09-24T10:05:00.000Z", by: "Layla", changes: [
        { field: "ownerMembershipId", from: "m-sara", to: "m-omar" },
        { field: "status", from: "new", to: "attempting_contact" },
      ] },
    ]);
    render(<DesignSystemProvider><ChangeHistory workspaceId="ws" leadId="lead" members={[{ id: "m-sara", displayName: "Sara" }, { id: "m-omar", displayName: "Omar" }]} /></DesignSystemProvider>);
    expect(await screen.findByText("Layla")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
    expect(screen.getByText("Sara")).toHaveAttribute("data-old");
    expect(screen.getByText("Omar")).toBeInTheDocument();
    expect(screen.getByText("Stage")).toBeInTheDocument();
  });

  it("says so when nothing has changed", async () => {
    vi.mocked(crmRequest).mockResolvedValue([]);
    render(<DesignSystemProvider><ChangeHistory workspaceId="ws" leadId="lead" members={[]} /></DesignSystemProvider>);
    expect(await screen.findByText("No changes yet.")).toBeInTheDocument();
  });
});
