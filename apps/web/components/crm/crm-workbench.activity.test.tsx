import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { ActivityPanel } from "./crm-workbench";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
vi.mock("next/font/google", () => ({ Caveat: () => ({ variable: "note-font" }) }));

describe("CRM activity panel actions", () => {
  it("keeps follow-up actions together and gives each action a visible icon", async () => {
    vi.mocked(crmRequest).mockResolvedValue({ data: [{
      id: "activity-1", title: "Follow up on opportunity", type: "task", status: "pending", version: 2,
      dueAt: "2026-09-24T09:00:00.000Z",
    }] });
    render(<DesignSystemProvider><ActivityPanel workspaceId="workspace-1" opportunityId="opportunity-1" /></DesignSystemProvider>);

    expect(await screen.findByText("Follow up on opportunity")).toBeInTheDocument();
    for (const name of ["Add activity", "Reschedule", "Complete"]) {
      expect(screen.getByRole("button", { name }).querySelector("svg")).toBeInTheDocument();
    }
    const complete = screen.getByRole("button", { name: "Complete" });
    expect(complete).toHaveAttribute("data-variant", "primary");
    expect(complete.parentElement?.className).toContain("activityActions");

    await userEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    expect(screen.getByRole("dialog", { name: "Reschedule activity" })).toBeInTheDocument();
  });

  it("shows assignments and activities in one timeline with the reassignment reason (PLM-095)", async () => {
    vi.mocked(crmRequest).mockResolvedValue({ data: [
      { id: "a-call", title: "No answer", type: "call", status: "completed", version: 1, completedAt: "2026-09-24T10:30:00.000Z" },
    ] });
    render(<DesignSystemProvider><ActivityPanel workspaceId="workspace-1" leadId="lead-1" assignments={[
      { id: "as-1", at: "2026-09-24T09:00:00.000Z", ownerName: "Sara", method: "round_robin" },
      { id: "as-2", at: "2026-09-24T10:05:00.000Z", ownerName: "Omar", method: "automatic", reason: "No call or note was logged before the ownership deadline" },
    ]} /></DesignSystemProvider>);
    expect(await screen.findByText("No answer")).toBeInTheDocument();
    const order = ["No answer", "Assigned to Omar", "Assigned to Sara"].map((text) => screen.getByText(text));
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1].compareDocumentPosition(order[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.getByText("No call or note was logged before the ownership deadline")).toBeInTheDocument();
  });
});
