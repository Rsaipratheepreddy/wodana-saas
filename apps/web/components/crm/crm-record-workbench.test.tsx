import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { CrmRecordWorkbench } from "./crm-record-workbench";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));

afterEach(() => vi.mocked(crmRequest).mockReset());

describe("CRM opportunity workbench", () => {
  it("shows the immutable enquiry decision without replacing it with current form data", async () => {
    vi.mocked(crmRequest).mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench
      id="opportunities"
      workspaceId="workspace-1"
      onChanged={vi.fn()}
      row={{
        id: "opportunity-1",
        title: "Villa renovation",
        leadId: "lead-1",
        status: "open",
        qualificationEvidence: {
          version: 1,
          leadId: "lead-1",
          serviceType: "interiors",
          selection: "service_specific",
          evaluatedAt: "2026-09-17T08:00:00.000Z",
          form: {
            id: "form-1",
            code: "palm",
            name: "Palm enquiry",
            version: 4,
            questions: [{ key: "property_type", label: "Property type", dataType: "select", required: true }],
          },
          answers: [{ questionKey: "property_type", value: "Villa" }],
        },
      }}
    /></DesignSystemProvider>);

    await user.click(screen.getByRole("tab", { name: "Qualification" }));
    expect(screen.getByText("Qualification handoff is frozen")).toBeVisible();
    expect(screen.getByText("Palm enquiry")).toBeVisible();
    expect(screen.getByText("Property type")).toBeVisible();
    expect(screen.getByText("Villa")).toBeVisible();
  });

  it("does not invent qualification history for a direct opportunity", async () => {
    vi.mocked(crmRequest).mockResolvedValue({ data: [] });
    const user = userEvent.setup();
    render(<DesignSystemProvider><CrmRecordWorkbench id="opportunities" workspaceId="workspace-1" onChanged={vi.fn()} row={{ id: "opportunity-2", title: "Direct opportunity", status: "open" }} /></DesignSystemProvider>);
    await user.click(screen.getByRole("tab", { name: "Qualification" }));
    expect(screen.getByText("No linked enquiry snapshot")).toBeVisible();
  });
});
