import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { ProjectWorkspace } from "./project-workspace";
import type { ProjectState } from "@/lib/projects/execution";
vi.mock("@/design-system", () => ({
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
  it("saves changed financial form values rather than restoring their defaults", async () => {
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
      fireEvent.change(screen.getByLabelText("Approved cost budget"), {
        target: { value: "85000" },
      });
      fireEvent.change(screen.getByLabelText("Forecast final cost"), {
        target: { value: "90000" },
      });
      fireEvent.change(
        screen.getByLabelText("Budget / forecast approval reference"),
        { target: { value: "BUDGET-APPROVAL" } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() => expect(request).toHaveBeenCalled());
      const payload = JSON.parse(String(request.mock.calls[0][1]?.body));
      expect(payload.budget).toBe(85000);
      expect(payload.forecast).toBe(90000);
      expect(payload.note).toBe("BUDGET-APPROVAL");
    } finally {
      request.mockRestore();
    }
  });
  it("opens schedules with baseline dates and milestones by default", () => {
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    expect(screen.getByRole("button", { name: "Schedule & milestones" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "Milestone timeline" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Project task timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add milestone" })).toBeTruthy();
  });
  it("shows a focused leaf-task board without duplicating work packages", () => {
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
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
      within(dialog).getByRole("button", { name: "Subtasks" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Comments (0)" }),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Edit task" }),
    ).toBeTruthy();
  });
  it("includes task scope, dependencies and readiness in the task form", () => {
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "Add task" });
    expect(within(dialog).getByLabelText("Accountable owner")).toBeTruthy();
    expect(within(dialog).getByLabelText("Preceding tasks")).toBeTruthy();
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
