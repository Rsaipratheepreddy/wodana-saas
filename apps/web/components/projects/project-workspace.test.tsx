import { describe, it, expect, vi, beforeEach } from "vitest";
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
const route = vi.hoisted(()=>({search:""}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(route.search) }));
beforeEach(()=>{route.search="";});
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
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
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
  it("renders the overview for legacy projects without an initiation record", () => {
    route.search = "view=summary";
    render(<ProjectWorkspace initial={initial} section="overview" />);
    expect(screen.getByRole("region", { name: "Project pulse" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Next actions/ })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Project delivery flow" })).not.toBeInTheDocument();
  });

  it("starts with approved project items instead of a second stage dashboard", () => {
    render(<ProjectWorkspace initial={initial} section="overview" />);
    expect(screen.getByRole("region", { name: "Project items" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Project delivery flow" })).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search items" })).toBeInTheDocument();
  });

  it("does not say existing legacy work cannot start when commercial records need reconciliation", () => {
    const legacy = structuredClone(initial);
    legacy.commercialReady = false;
    legacy.data.workflow = {
      currentStageKey: "delivery",
      currentStageStartedAt: "2026-09-01T00:00:00.000Z",
      history: [],
      template: {
        id: null,
        code: "standard_delivery",
        name: "Standard project delivery",
        source: "built_in",
        version: 0,
        stages: [
          { key: "delivery", visibleName: "Delivery", description: "", phase: "active", ownerRole: null, exitGates: [] },
          { key: "handover", visibleName: "Handover", description: "", phase: "handover", ownerRole: null, exitGates: [] },
        ],
      },
    };
    render(<ProjectWorkspace initial={legacy} section="overview" />);
    expect(screen.getByText("Review legacy commercial record")).toBeInTheDocument();
    expect(screen.queryByText(/work cannot start yet/i)).not.toBeInTheDocument();
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
      route.search="view=summary";
      const rendered=render(<ProjectWorkspace initial={initial} section="overview" />);
      await user.click(screen.getByRole("button", { name: "More" }));
      await user.click(await screen.findByRole("menuitem", { name: "Project settings" }));
      expect(screen.getByRole("dialog", { name: "Project controls" })).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/Project \/ work-order reference/), { target: { value: "PLM-001" } });
      await user.click(screen.getByRole("button", { name: "Save project controls" }));
      route.search="";
      rendered.rerender(<ProjectWorkspace initial={initial} section="overview" />);
      await waitFor(() => expect(screen.getByRole("link", { name: /Release project hold/ })).toHaveAttribute("href", "/workspace/projects/p/overview"));
      const methods=request.mock.calls.map(([, options]) => options?.method ?? "GET");
      expect(methods.filter(method=>method==="POST")).toHaveLength(1);
      expect(methods.slice(methods.indexOf("POST")+1)).toContain("GET");
    } finally {
      request.mockRestore();
    }
  });

  it("opens budget setup directly from procurement", () => {
    render(<ProjectWorkspace initial={{...initial,data:{...initial.data,budget:0}}} section="procurement" />);
    fireEvent.click(screen.getByRole("button",{name:"Set budget"}));
    expect(screen.getByLabelText(/Approved cost budget/)).toBeInTheDocument();
    expect(screen.queryByText(/Order costs/)).not.toBeInTheDocument();
  });

  it("saves changed financial form values rather than restoring their defaults", async () => {
    const user = userEvent.setup();
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async()=>new Response(JSON.stringify({ ...initial, data: initial.data }), { status: 200 }));
    try {
      render(<ProjectWorkspace initial={initial} section="commercial" />);
      fireEvent.click(
        screen.getByRole("button", { name: /Set budget|Edit budget/ }),
      );
      await user.clear(screen.getByLabelText(/Approved cost budget/));
      await user.type(screen.getByLabelText(/Approved cost budget/), "85000");
      await user.clear(screen.getByLabelText(/Forecast final cost/));
      await user.type(screen.getByLabelText(/Forecast final cost/), "90000");
      await user.type(screen.getByLabelText(/Budget \/ forecast approval reference/), "BUDGET-APPROVAL");
      await user.click(screen.getByRole("button", { name: "Save changes" }));
      await waitFor(() => expect(request).toHaveBeenCalled());
      const payload = JSON.parse(String(request.mock.calls.find(([,options])=>options?.method==="POST")?.[1]?.body));
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
    expect(screen.getByRole("button", { name: "Sync scope changes" })).toBeVisible();
  });
  it("opens timeline with baseline dates and milestones", () => {
    route.search="view=schedule";
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    expect(screen.getByRole("heading", { name: "Milestones" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Project task timeline" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add milestone" })).toBeTruthy();
  });
  it("opens the exact protected planning file from a released design document", () => {
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
    readOnly.canReport = false;
    readOnly.canReview = false;
    render(<ProjectWorkspace initial={readOnly} section="plan-teams" />);
    const card = within(screen.getByRole("region", { name: "Project task board" })).getByRole("button", { name: /Install wardrobes · Bedroom Fit soft-close hardware/ }).closest("article");
    expect(card).toHaveAttribute("draggable", "false");
    expect(screen.queryByRole("button", { name: /Start task|Review readiness/ })).toBeNull();
  });
  it("keeps execution controls disabled until commercial release", () => {
    const planning = structuredClone(initial);
    planning.commercialReady = false;
    planning.data.phase = "planning";
    planning.data.tasks[1].status = "planned";
    render(<ProjectWorkspace initial={planning} section="plan-teams" />);
    const board = screen.getByRole("region", { name: "Project task board" });
    const card = within(board).getByRole("button", { name: /Install wardrobes · Bedroom Fit soft-close hardware/ }).closest("article");
    expect(card).toHaveAttribute("draggable", "false");
    expect(within(board).getByRole("button", { name: /Start task|Review readiness/ })).toBeDisabled();
    fireEvent.click(within(board).getByRole("button", { name: /Install wardrobes · Bedroom Fit soft-close hardware/ }));
    expect(within(screen.getByRole("dialog", { name: "Fit soft-close hardware" })).getByRole("button", { name: "Start work" })).toBeDisabled();
  });
  it("opens ownership, subtasks, comments and progress from one task", () => {
    render(<ProjectWorkspace initial={initial} section="plan-teams" />);
    fireEvent.click(screen.getByRole("button", { name: /Install wardrobes · Bedroom Fit soft-close hardware/ }));
    const dialog = screen.getByRole("dialog", { name: "Fit soft-close hardware" });
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
    expect(within(dialog).getByRole("button",{name:/Assignee|Owner/})).toBeTruthy();
    expect(within(dialog).getByRole("group", { name: "Preceding tasks" })).toBeTruthy();
    expect(within(dialog).getByLabelText("Materials ready")).toBeTruthy();
  });
  it("makes daily progress a clear submit-for-review workflow", () => {
    render(<ProjectWorkspace initial={initial} section="daily-progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Add daily update" }));
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Evidence (0)" }));
    expect(
      screen.getByLabelText("Photo notes / signed site record reference"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Upload site photos")).toHaveAttribute(
      "multiple",
    );
    expect(screen.getByRole("button", { name: "Save draft" })).toBeTruthy();
  });
  it("exposes crew breakdown and schedule recovery details in a daily report", () => {
    render(<ProjectWorkspace initial={initial} section="daily-progress" />);
    fireEvent.click(screen.getByRole("button", { name: "Add daily update" }));
    fireEvent.click(screen.getByRole("button", { name: "Add crew line" }));
    expect(screen.getByLabelText("Trade / role")).toBeVisible();
    expect(screen.getByLabelText("Hours each")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Safety & next steps" }));
    fireEvent.change(screen.getByLabelText("Schedule impact"), { target: { value: "blocked" } });
    expect(screen.getByLabelText("Recovery plan")).toBeVisible();
    expect(screen.getByLabelText("Next update owner")).toBeVisible();
  });
  it("opens an existing daily report as a document and edits only on explicit action", () => {
    const state = structuredClone(initial);
    state.data.reports = [
      {
        id: "r",
        date: "2026-09-07",
        summary: "Bedroom installation",
        workforce: [{ trade: "Joinery", people: 2, hours: 8 }],
        scheduleImpact: "watch",
        impactReason: "Access delayed",
        recoveryPlan: "Confirm an early site slot",
        nextUpdateOwnerId: "m",
        nextUpdateDate: "2026-09-08",
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
    expect(within(view).getAllByText("Access delayed").length).toBeGreaterThan(0);
    expect(within(view).getByText("Crew & labour")).toBeTruthy();
    expect(within(view).getByText("Confirm an early site slot")).toBeTruthy();
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
  it("opens task details in a modal with an editable assignee", async () => {
    const user=userEvent.setup();
    const request=vi.spyOn(globalThis,"fetch").mockImplementation(async (_url,options)=>new Response(JSON.stringify(options?.method==="POST"?{data:initial.data}:initial),{status:200}));
    try {
      render(<ProjectWorkspace initial={initial} section="site-work"/>);
      await user.click(screen.getByRole("button",{name:/Install wardrobes · Bedroom Fit soft-close hardware/}));
      const dialog=screen.getByRole("dialog",{name:"Fit soft-close hardware"});
      expect(within(dialog).getByRole("region",{name:"Task properties"})).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button",{name:/Assignee/}));
      await user.click(await screen.findByRole("option",{name:"Manager"}));
      await waitFor(()=>expect(request).toHaveBeenCalled());
      const post=request.mock.calls.find(([,options])=>options?.method==="POST");
      expect(JSON.parse(String(post?.[1]?.body)).task).toMatchObject({id:"child",ownerId:"m",assigneeIds:["m"]});
    } finally {request.mockRestore();}
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

 it("opens factory dispatch and receiving inside the task without leaving the project",async()=>{
  const data={...initial.data,tasks:[{...initial.data.tasks[0],location:"factory" as const,approved:4,quantity:4,status:"completed" as const}],dispatches:[]};
  render(<ProjectWorkspace initial={{...initial,data}} section="plan-teams"/>);
  fireEvent.click(screen.getByText("Install wardrobes",{selector:"strong"}));
  fireEvent.click(await screen.findByRole("button",{name:"Dispatch & site receipt"}));
  expect(await screen.findByRole("dialog",{name:"Factory dispatch & site receipt"})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Back to work"})).toBeInTheDocument();
 });

it('lets a planner correct a returned document draft and link BOQ scope',async()=>{
 const data=structuredClone(initial);
 data.data.documents=[{id:'draft-doc',title:'Returned drawing',kind:'drawing',revision:'R1',url:'https://example.com/drawing.pdf',note:'Check dimension',status:'draft',replaces:'',published:false,scopeLineIds:[]}];
 render(<ProjectWorkspace initial={data} section="documents"/>);
 fireEvent.click(screen.getByRole('button',{name:'Actions for Returned drawing'}));
 fireEvent.click(await screen.findByRole('menuitem',{name:'Edit draft'}));
 expect(screen.getByRole('dialog',{name:'Edit document draft'})).toBeVisible();
 expect(screen.getByRole('textbox',{name:'Revision'})).toHaveValue('R1');
 expect(screen.getByRole('textbox',{name:'Document title'})).toHaveValue('Returned drawing');
 expect(screen.getByRole('button',{name:/Released BOQ items/})).toBeVisible();
});
