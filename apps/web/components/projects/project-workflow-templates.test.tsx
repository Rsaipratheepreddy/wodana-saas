import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ProjectWorkflowTemplatesResponse } from "@/lib/projects/workflow-templates";
import { ProjectWorkflowTemplatesPage } from "./project-workflow-templates";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const data: ProjectWorkflowTemplatesResponse = {
  defaultTemplate: {
    id: null,
    version: 0,
    code: "standard_delivery",
    name: "Standard project delivery",
    description: "A clear project lifecycle.",
    isDefault: true,
    status: "active",
    source: "built_in",
    updatedAt: null,
    stages: [
      { key: "planning", visibleName: "Planning", description: "Plan the work.", phase: "planning", ownerRole: "project_manager", exitGates: ["tasks_planned"] },
      { key: "completed", visibleName: "Completed", description: "Keep the record.", phase: "completed", ownerRole: null, exitGates: [] },
    ],
  },
  templates: [],
  supportedExitGates: ["project_manager_assigned", "tasks_planned", "all_tasks_closed", "all_snags_closed", "all_handovers_accepted", "finance_closed"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("project workflow templates", () => {
  it("uses the shared grid and opens the complete workflow in one editor", async () => {
    const user = userEvent.setup();
    render(<DesignSystemProvider><ProjectWorkflowTemplatesPage initialData={data} workspaceId="00000000-0000-4000-8000-000000000001" /></DesignSystemProvider>);

    expect(screen.getByRole("table", { name: "Project workflow templates" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create template" }));
    const editor = await screen.findByRole("dialog", { name: "Create workflow template" });
    expect(within(editor).getByRole("textbox", { name: /Template name/ })).toHaveValue("Standard project delivery copy");
    expect(within(editor).getByRole("heading", { name: "Stages" })).toBeVisible();
    expect(within(editor).getAllByRole("textbox", { name: /Stage name/ })).toHaveLength(2);
  });

  it("saves a new version through the bounded project API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<DesignSystemProvider><ProjectWorkflowTemplatesPage initialData={data} workspaceId="00000000-0000-4000-8000-000000000001" /></DesignSystemProvider>);

    await user.click(screen.getByRole("button", { name: "Create template" }));
    const editor = await screen.findByRole("dialog", { name: "Create workflow template" });
    await user.click(within(editor).getByRole("button", { name: "Save workflow" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/workspace\/projects\/workflow-templates\/[0-9a-f-]{36}\?workspaceId=/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ version: 0, isDefault: true });
    expect(refresh).toHaveBeenCalledOnce();
  });
});
