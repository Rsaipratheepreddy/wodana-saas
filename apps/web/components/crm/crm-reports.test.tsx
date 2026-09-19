import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { crmRequest } from "@/lib/crm/client";
import { CrmReports } from "./crm-reports";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));
afterEach(() => vi.mocked(crmRequest).mockReset());

describe("CrmReports", () => {
  it("keeps the backend report contracts in purpose-built views instead of a mixed record table", async () => {
    const user = userEvent.setup();
    render(<CrmReports initialData={structuredClone(crmScreenFixture("crm-reports"))} />);

    expect(screen.getByRole("heading", { name: "Reports", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Sources breakdown" })).toHaveTextContent("Instagram");
    expect(screen.getByRole("table", { name: "Sources breakdown" })).toHaveTextContent("3 enquiries");

    await user.click(screen.getByRole("tab", { name: "Pipeline" }));
    expect(screen.getByRole("table", { name: "Pipeline breakdown" })).toHaveTextContent("Design & build sales · Proposal");
    expect(screen.getByRole("table", { name: "Pipeline breakdown" })).toHaveTextContent("1,850,000");
  });

  it("loads an explicit backend grouping for enquiry health", async () => {
    vi.mocked(crmRequest).mockResolvedValue({
      report: "lead-flow",
      groupBy: "freshness",
      rows: [{ id: "current", label: "Current", leads: 3, qualified: 0, unassigned: 0, stale: 0 }],
      summary: { leads: 3, qualified: 0, unassigned: 0, stale: 0 },
      reconciliation: { totalLeads: 3, groupedLeads: 3, matches: true },
    });
    const user = userEvent.setup();
    const data = structuredClone(crmScreenFixture("crm-reports"));
    render(<CrmReports initialData={data} />);

    await user.click(screen.getByRole("tab", { name: "Enquiry health" }));
    await user.click(screen.getByRole("button", { name: /Break down by/ }));
    await user.click(screen.getByRole("option", { name: "Freshness" }));

    await waitFor(() => expect(crmRequest).toHaveBeenCalledWith(data.workspaceId, "reports/lead-flow?groupBy=freshness"));
    expect(screen.getByRole("table", { name: "Enquiry health breakdown" })).toHaveTextContent("Current");
  });
});
