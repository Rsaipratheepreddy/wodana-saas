import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { crmScreenFixture } from "@/lib/crm/screens";
import { crmRequest } from "@/lib/crm/client";
import { CrmOpportunities } from "./crm-opportunities";

vi.mock("@/lib/crm/client", async (original) => ({ ...await original<object>(), crmRequest: vi.fn() }));

describe("CrmOpportunities", () => {
  it("shows every opportunity with its backend pipeline and stage", () => {
    render(<CrmOpportunities initialData={structuredClone(crmScreenFixture("opportunities"))} />);

    expect(screen.getByRole("heading", { name: "Opportunities", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Opportunities" })).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /Emirates Hills villa interior renovation/ })).getByText("Proposal")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /DIFC executive office fit-out/ })).getByText("Negotiation")).toBeInTheDocument();
  });

  it("does not hide an opportunity when its stage is missing or inactive", () => {
    const data = structuredClone(crmScreenFixture("opportunities"));
    data.items.push({ id: "orphan", title: "New commercial brief", partyName: "Layla Omar", pipelineName: "Design & build sales", stageId: "inactive-stage", status: "open" });
    render(<CrmOpportunities initialData={data} />);

    expect(screen.getByRole("row", { name: /New commercial brief/ }).querySelector('[data-column="stage"]')).toHaveTextContent("Not set");
  });

  it("loads additional backend cursor pages", async () => {
    const user = userEvent.setup();
    const data = structuredClone(crmScreenFixture("opportunities"));
    data.nextCursor = "page-2";
    vi.mocked(crmRequest).mockImplementation(async (_workspaceId, path) => path === "pipelines"
      ? { data: data.supporting.pipelines }
      : { data: [{ id: "new-opportunity", title: "Marina renovation", partyName: "Layla Omar", pipelineName: "Design & build sales", status: "open" }], nextCursor: null });
    render(<CrmOpportunities initialData={data} />);

    await user.click(screen.getByRole("button", { name: "Load more opportunities" }));
    await waitFor(() => expect(screen.getByText("Marina renovation")).toBeInTheDocument());
    expect(crmRequest).toHaveBeenCalledWith(data.workspaceId, "opportunities?limit=100&cursor=page-2");
    expect(screen.queryByRole("button", { name: "Load more opportunities" })).not.toBeInTheDocument();
  });
});
