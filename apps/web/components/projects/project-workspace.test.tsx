import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { ProjectWorkspace } from "./project-workspace";
import userEvent from "@testing-library/user-event";
import type { ProjectState } from "@/lib/projects/execution";
vi.mock("@/design-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/design-system")>()),
  InspectorSheet: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
  ControlledModalDialog: ({
    isOpen,
    title,
    children,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));
const initial: ProjectState = {
  workspaceId: "w",
  id: "p",
  caseId: "c",
  name: "Villa project",
  customer: "Client",
  memberId: "m",
  canManage: true,
  canReview: true,
  canReport: true,
  canBuy: true,
  commercialReady: true,
  members: [
    { id: "m", name: "Manager" },
    { id: "f", name: "Foreman" },
  ],
  resources: [],
  bookings: [],
  pulse: {
    health: "clear",
    counts: {
      packages: 0,
      readyPackages: 0,
      activePackages: 0,
      blockedPackages: 0,
      overdueTasks: 0,
      awaitingInspection: 0,
    },
    nextActions: [],
  },
  data: {
    revision: 1,
    phase: "active",
    scope: null,
    tasks: [
      {
        id: "t",
        title: "Install wardrobes",
        package: "Joinery",
        description: "Site installation",
        parentId: "",
        area: "Bedroom",
        location: "site",
        ownerId: "f",
        assigneeIds: [],
        resourceId: "",
        start: "2026-09-07",
        end: "2026-09-10",
        baselineStart: "2026-09-07",
        baselineEnd: "2026-09-10",
        predecessors: [],
        quantity: 4,
        unit: "nos",
        weight: 1,
        approved: 1,
        status: "in_progress",
        priority: "normal",
        inspectionRequired: true,
        scopeIds: [],
        drawingId: "",
        readiness: { scope: true, access: true, materials: true },
        blocker: "",
      },
      {
        id: "child",
        title: "Fit soft-close hardware",
        package: "Joinery",
        description: "",
        parentId: "t",
        area: "Bedroom",
        location: "site",
        ownerId: "f",
        assigneeIds: [],
        resourceId: "",
        start: "2026-09-07",
        end: "2026-09-10",
        baselineStart: "2026-09-07",
        baselineEnd: "2026-09-10",
        predecessors: [],
        quantity: 4,
        unit: "nos",
        weight: 1,
        approved: 1,
        status: "in_progress",
        priority: "normal",
        inspectionRequired: true,
        scopeIds: [],
        drawingId: "",
        readiness: { scope: true, access: true, materials: true },
        blocker: "",
      },
    ],
    reports: [],
    materials: [],
    orders: [],
    documents: [],
    snags: [],
    handovers: [],
    comments: [],
    audit: [],
    processed: [],
    budget: 0,
    forecast: 0,
    financeClosed: false,
    financeEvidence: "",
  },
};
describe("project workspace", () => {
  it("shows the complete evidence-based delivery flow from planning to close", () => {
    render(<ProjectWorkspace initial={initial} section="overview" />);
    const flow = screen.getByRole("navigation", { name: "Project delivery flow" });
    expect(within(flow).getByRole("link", { name: /^Plan/ })).toHaveAttribute("href", "/workspace/projects/p/plan-teams");
    expect(within(flow).getByRole("link", { name: /^Materials & orders/ })).toHaveAttribute("href", "/workspace/projects/p/material-planning");
    expect(within(flow).getByRole("link", { name: /^Production/ })).toHaveAttribute("href", "/workspace/projects/p/production");
    expect(within(flow).getByRole("link", { name: /^Onsite/ })).toHaveAttribute("href", "/workspace/projects/p/site-work");
    expect(within(flow).getByText("0/1 site tasks complete")).toBeVisible();
    expect(within(flow).getByRole("link", { name: /^Quality & close/ })).toHaveAttribute("href", "/workspace/projects/p/handover");
  });

  it("refreshes the backend decision queue after a successful project command", async () => {
    const user = userEvent.setup();
    const updated = { ...initial.data, revision: 2 };
    const refreshed: ProjectState = {
      ...initial,
      data: updated,
      pulse: {
        ...initial.pulse,
        health: "blocked",
        nextActions: [{
          id: "hold-action",
          kind: "resolve_project_hold",
          priority: "critical",
          title: "Release project hold",
          detail: "Manager approval is required",
          recordId: initial.id,
        }],
      },
    };
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) =>
      new Response(JSON.stringify(options?.method === "POST" ? { data: updated } : refreshed), { status: 200 }),
    );
    try {
      render(<ProjectWorkspace initial={initial} section="overview" />);
      await user.click(screen.getByRole("button", { name: "More" }));
      await user.click(await screen.findByRole("menuitem", { name: "Project settings" }));
      expect(screen.getByRole("dialog", { name: "Project controls" })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/Project \/ work-order reference/), { target: { value: "PLM-001" } });
      await user.click(screen.getByRole("button", { name: "Save project controls" }));
      await waitFor(() => expect(screen.getByRole("link", { name: /Release project hold/ })).toHaveAttribute("href", "/workspace/projects/p/overview"));
      expect(request.mock.calls.map(([, options]) => options?.method ?? "GET")).toEqual(["POST", "GET"]);
    } finally {
      request.mockRestore();
    }
  });

  it("saves changed financial form values rather than restoring their defaults", async () => {
    const user = userEvent.setup();
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ data: initial.data }), { status: 200 }),
      );
    try {
      render(<ProjectWorkspace initial={initial} section="commercial" />);
      fireEvent.click(
        screen.getByRole("button", { name: "Update financial plan" }),
      );
      await user.clear(screen.getByLabelText(/Approved cost budget/));
      await user.type(screen.getByLabelText(/Approved cost budget/), "85000");
      await user.clear(screen.getByLabelText(/Forecast final cost/));
      await user.type(screen.getByLabelText(/Forecast final cost/), "90000");
      await user.type(screen.getByLabelText(/Budget \/ forecast approval reference/), "BUDGET-APPROVAL");
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(request).toHaveBeenCalled());
      const payload = JSON.parse(String(request.mock.calls[0][1]?.body));
      expect(payload.budget).toBe(85000);
      expect(payload.forecast).toBe(90000);
      expect(payload.note).toBe("BUDGET-APPROVAL");
    } finally {
      request.mockRestore();
    }
  });
  it("shows released change-case lineage beside the immutable commercial baseline", () => {
    const controlled = structuredClone(initial);
    controlled.data.scope = {
      quoteId: "base",
      quoteNumber: 1,
      currency: "AED",
      value: 500,
      lines: [],
    };
    controlled.data.changeCases = [{
      requestId: "change",
      number: 3,
      kind: "replacement",
      quoteIds: ["credit", "addition"],
      sourceLineIds: ["line"],
      releasedAt: "2026-09-18T00:00:00.000Z",
    }];
    render(<ProjectWorkspace initial={controlled} section="commercial" />);
    expect(screen.getByText("Change C3 · replacement")).toBeVisible();
    expect(screen.getByText("2 accepted documents")).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh accepted changes" })).toBeVisible();
  });
  it("opens schedules with baseline dates and milestones by default", () => {
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    expect(screen.getByRole("radio", { name: "Schedule & milestones" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("heading", { name: "Milestones" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Project task timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add milestone" })).toBeTruthy();
  });
  it("opens the exact protected pre-execution file from a released design document", () => {
    const released = structuredClone(initial);
    released.data.documents = [{
      id: "document",
      title: "Wardrobe elevation · Rev 2",
      kind: "drawing",
      revision: "D2",
      url: "",
      note: "Approved design revision",
      status: "approved",
      replaces: "",
      published: false,
      sourceDesignVersionId: "design-version",
      sourceDesignAssetId: "design-asset",
      scopeLineIds: ["line"],
    }];
    render(<ProjectWorkspace initial={released} section="documents" />);
    expect(screen.getByRole("link", { name: /Wardrobe elevation/ })).toHaveAttribute(
      "href",
      "/api/project-files/p/design-asset?workspaceId=w",
    );
  });
  it("shows a focused leaf-task board without duplicating work packages", () => {
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    fireEvent.click(screen.getByRole("radio", { name: "Tasks" }));
    expect(screen.getByRole("region", { name: "Project task board" })).toBeTruthy();
    expect(
      within(screen.getByRole("region", { name: "Project task board" })).getByRole("button", { name: /Install wardrobes · Bedroom Fit soft-close hardware/ }),
    ).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Project task board" })).getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText("Work packages")).toBeNull();
  });
  it("does not make task cards draggable for read-only members", () => {
    const readOnly = structuredClone(initial);
    readOnly.canManage = false;
    render(<ProjectWorkspace initial={readOnly} section="plan-teams" />);
    fireEvent.click(screen.getByRole("radio", { name: "Tasks" }));
    const card = within(screen.getByRole("region", { name: "Project task board" })).getByRole("button", { name: /Install wardrobes · Bedroom Fit soft-close hardware/ }).closest("article");
    expect(card).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
  it("keeps execution controls disabled until commercial release", () => {
    const planning = structuredClone(initial);
    planning.commercialReady = false;
    planning.data.phase = "planning";
    planning.data.tasks[1].status = "planned";
    render(<ProjectWorkspace initial={planning} section="plan-teams" />);
    fireEvent.click(screen.getByRole("radio", { name: "Tasks" }));
    const board = screen.getByRole("region", { name: "Project task board" });
    const card = within(board).getByRole("button", { name: /Install wardrobes · Bedroom Fit soft-close hardware/ }).closest("article");
    expect(card).toHaveAttribute("draggable", "false");
    expect(within(board).getByRole("button", { name: "Start" })).toBeDisabled();
    fireEvent.click(within(board).getByRole("button", { name: /Install wardrobes · Bedroom Fit soft-close hardware/ }));
    expect(within(screen.getByRole("dialog", { name: "Fit soft-close hardware" })).getByRole("button", { name: "Start work" })).toBeDisabled();
  });
  it("opens ownership, subtasks, comments and progress from one task", () => {
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    fireEvent.click(
      screen.getByRole("button", { name: /Install wardrobes Bedroom/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "Install wardrobes" });
    expect(
      within(dialog).getByRole("radio", { name: "Subtasks" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("radio", { name: "Comments (0)" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "More" }),
    ).toBeTruthy();
  });
  it("includes task scope, dependencies and readiness in the task form", () => {
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "Add task" });
    expect(within(dialog).getByLabelText("Accountable owner")).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Preceding tasks" })).toBeTruthy();
    expect(within(dialog).getByLabelText("Materials ready")).toBeTruthy();
  });
  it("makes daily progress a clear submit-for-review workflow", () => {
    render(<ProjectWorkspace initial={initial} section="daily-progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Add daily update" }));
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Photos (0)" }));
    expect(
      screen.getByLabelText("Photo notes / signed site record reference"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Upload site photos")).toHaveAttribute(
      "multiple",
    );
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
  });
  it("opens an existing daily report as a document and edits only on explicit action", () => {
    const state = structuredClone(initial);
    state.data.reports = [
      {
        id: "r",
        date: "2026-09-07",
        summary: "Bedroom installation",
        shift: "Day",
        location: "site",
        authorId: "m",
        author: "Manager",
        status: "draft",
        entries: [{ taskId: "child", quantity: 1 }],
        hours: 8,
        people: 2,
        materials: "Hardware received",
        issues: "Access delayed",
        tomorrow: "Finish hinges",
        evidence: "Site record",
        note: "",
      },
    ];
    render(<ProjectWorkspace initial={state} section="daily-progress" />);
    fireEvent.click(screen.getByRole("button", { name: /Open report/ }));
    const view = screen.getByRole("dialog", { name: "Daily report" });
    expect(within(view).getByText("Work completed")).toBeTruthy();
    expect(within(view).queryByRole("textbox")).toBeNull();
    expect(within(view).getByText("Access delayed")).toBeTruthy();
    fireEvent.click(within(view).getByRole("button", { name: "Edit draft" }));
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
  });
  it("hides planner creation actions for reporters", () => {
    render(
      <ProjectWorkspace
        initial={{ ...initial, canManage: false }}
        section="plan-teams"
      />,
    );
    expect(screen.queryByRole("button", { name: "Add task" })).toBeNull();
  });
  it("keeps site and factory work as views of the same tasks", () => {
    render(<ProjectWorkspace initial={initial} section="production" />);
    expect(
      screen.queryByRole("button", { name: /Install wardrobes Bedroom/ }),
    ).toBeNull();
    expect(screen.getByText("No manufacturing jobs in this view")).toBeTruthy();
  });
  it("shows preparation release requirements on a planning project", () => {
    render(
      <ProjectWorkspace
        initial={{ ...initial, commercialReady: false }}
        section="plan-teams"
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Review release →" })
        .getAttribute("href"),
    ).toBe("/workspace/pre-projects/cases/c/execution-release");
  });
});
