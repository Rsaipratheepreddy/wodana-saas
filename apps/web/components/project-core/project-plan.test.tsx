import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { OpenWork as OpenWorkState, PackagePlan, SettingsState, Sprint, SprintDetail, WorkBoard, WorkDetail, WorkInsights, WorkItem } from "@/lib/project-core/types";
import { OpenWork } from "./open-work";
import { ProjectPlan } from "./project-plan";
import { ProjectSettingsPage } from "./project-settings";

// The URL is the plan's state (?view=board, ?item=…): a tiny store stands in for the router.
const nav = vi.hoisted(() => {
  let query = "";
  const listeners = new Set<() => void>();
  return {
    get: () => query,
    set: (next: string) => { query = next; listeners.forEach((listener) => listener()); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
});
vi.mock("next/navigation", async () => {
  const React = await import("react");
  return {
    useRouter: () => ({ push: vi.fn(), replace: (url: string) => nav.set(url.split("?")[1] ?? "") }),
    usePathname: () => "/workspace/projects/p1/plan",
    useSearchParams: () => new URLSearchParams(React.useSyncExternalStore(nav.subscribe, nav.get, nav.get)),
  };
});

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const item = (patch: Partial<WorkItem> & Pick<WorkItem, "id" | "number" | "title">): WorkItem => ({
  projectId: PID, type: "task", parentId: null, packageId: null, boqLineId: null, stageId: null, sprintId: null, status: "todo", priority: "normal",
  assigneeId: null, assigneeName: null, startDate: null, dueDate: null, baselineStart: null, baselineDue: null, completedAt: null, createdBy: "u1", version: 1,
  subtasks: 0, subtasksDone: 0, comments: 0, blockedBy: [], needsMaterials: false, severity: null, source: null, areaId: null, fixedBy: null, ...patch,
});
const drawings = item({ id: "i1", number: 1, title: "Kitchen shop drawings", packageId: "k1", assigneeId: "m2", assigneeName: "Dana Karim", dueDate: "2099-10-10", priority: "high", subtasks: 1,
  blockedBy: [{ id: "i3", number: 3, title: "Marble thickness", type: "blocker", status: "todo" }], version: 3 });
const sheet = item({ id: "i2", number: 2, title: "Elevation sheet", packageId: "k1", parentId: "i1" });
const marble = item({ id: "i3", number: 3, title: "Marble thickness", type: "blocker", assigneeId: "m1", assigneeName: "Omar Haddad" });
const handles = item({ id: "i4", number: 4, title: "Order handles", status: "done", completedAt: "2026-09-20T10:00:00Z" });
const board = (items: WorkItem[] = [drawings, sheet, marble, handles], extra: Partial<WorkBoard> = {}): WorkBoard => ({
  items, packages: [{ id: "k1", name: "Kitchen joinery", supply: "make", planned: true }], stages: [{ id: "s1", name: "Technical drawings", status: "current" }], lines: [],
  people: [{ membershipId: "m1", name: "Omar Haddad" }, { membershipId: "m2", name: "Dana Karim" }], me: "m1", canEdit: true, canManage: true, item: null,
  calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [] }, promiseDate: "2099-12-01", startDate: null, baseline: null, sprints: [], critical: { finish: null, float: {} }, progress: { project: 40, packages: { k1: 40 } }, materials: {}, areas: [], aftercare: false, ...extra,
});
const detail = (base: WorkItem, patch: Partial<WorkDetail> = {}): WorkDetail => ({
  ...base, description: "", createdByName: "Omar Haddad", createdAt: "2026-09-22T09:00:00Z", startedAt: null, subtaskIds: base.id === "i1" ? ["i2"] : [],
  before: base.id === "i1" ? [{ ...marble, kind: "fs", lagDays: 0 }] : [], after: [],
  activity: [{ id: "e1", kind: "created", detail: {}, by: "Omar Haddad", at: "2026-09-22T09:00:00Z" }, { id: "c1", kind: "comment", body: "Waiting on the marble.", by: "Dana Karim", at: "2026-09-23T09:00:00Z" }],
  photos: [], ...patch,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && typeof init.body === "string").map(([, init]) => JSON.parse(String(init!.body)));
const uploads = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && init.body instanceof FormData).map(([url, init]) => ({ url: String(url), file: (init!.body as FormData).get("file") as File }));
const plan = () => render(<DesignSystemProvider><ProjectPlan workspaceId="w" projectId={PID} /></DesignSystemProvider>);

describe("project plan", () => {
  beforeEach(() => nav.set(""));
  afterEach(() => vi.unstubAllGlobals());

  it("lists open work by package with subtasks under their task, done work last, and filters to mine", async () => {
    mount(() => board());
    plan();
    const table = await screen.findByRole("table", { name: "Plan" }).catch(() => screen.findByRole("grid", { name: "Plan" }));
    const text = table.textContent ?? "";
    expect(text.indexOf("Kitchen joinery · 1 · 40% done")).toBeLessThan(text.indexOf("Kitchen shop drawings"));
    expect(text.indexOf("Kitchen shop drawings")).toBeLessThan(text.indexOf("Elevation sheet"));
    expect(text.indexOf("No package · 1")).toBeLessThan(text.indexOf("Marble thickness"));
    expect(text.indexOf("Done · 1")).toBeLessThan(text.indexOf("Order handles"));
    expect(table).toHaveTextContent("Blocked by #3");
    expect(table).toHaveTextContent("0 of 1 subtasks · High");
    await userEvent.click(screen.getByRole("button", { name: "Everyone" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Assigned to me" }));
    await waitFor(() => expect(screen.queryByText("Kitchen shop drawings")).not.toBeInTheDocument());
    expect(screen.getByText("Marble thickness")).toBeInTheDocument();
  });

  it("moves a card to another column on the board with the item's version", async () => {
    nav.set("view=board");
    const fetcher = mount((_url, body) => (body ? board([{ ...marble, status: "in_progress", version: 2 }]) : board()));
    plan();
    const card = await screen.findByRole("button", { name: "#3 Marble thickness" });
    const store = new Map<string, string>();
    const dataTransfer = { types: ["text/x-wd-card"], setData: (type: string, value: string) => store.set(type, value), getData: (type: string) => store.get(type) ?? "", effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    const column = screen.getByRole("region", { name: "In progress" });
    fireEvent.dragOver(column, { dataTransfer });
    fireEvent.drop(column, { dataTransfer });
    await waitFor(() => expect(posts(fetcher)).toEqual([{ action: "update", itemId: "i3", version: 1, status: "in_progress" }]));
  });

  it("opens an item: changes its status, adds a subtask, reports a blocker and comments", async () => {
    let current = detail(drawings);
    const fetcher = mount((url, body) => {
      if (!body) return url.includes("/work/i1") ? current : board();
      if (body.action === "update") current = detail({ ...drawings, status: "in_progress", version: 4 });
      return board(undefined, { item: body.action === "update" ? current : null });
    });
    plan();
    await userEvent.click(await screen.findByText("Kitchen shop drawings"));
    const panel = await screen.findByRole("dialog");
    await within(panel).findByText("Waiting on the marble.");
    expect(within(panel).getByText("Blocked")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /#3\s*Marble thickness/ })).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: /To do/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "In progress" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "update", itemId: "i1", version: 3, status: "in_progress" }));

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "New subtask" }), "Section drawing");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "create", parentId: "i1", title: "Section drawing" }));

    await userEvent.click(within(dialog).getByRole("button", { name: "Report a blocker" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "What's in the way" }), "Site not ready");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "create", type: "blocker", blocks: "i1", title: "Site not ready" }));

    await userEvent.type(within(dialog).getByRole("textbox", { name: "Comment" }), "Marble arrives Monday.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Comment" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "comment", itemId: "i1", body: "Marble arrives Monday." }));
  });

  it("marks a task as needing its package's materials when it starts", async () => {
    let current = detail(drawings);
    const fetcher = mount((url, body) => {
      if (!body) return url.includes("/work/i1") ? current : board();
      current = detail({ ...drawings, needsMaterials: true, version: 4 });
      return board(undefined, { item: current });
    });
    plan();
    await userEvent.click(await screen.findByText("Kitchen shop drawings"));
    const panel = await screen.findByRole("dialog");
    const needs = await within(panel).findByRole("switch", { name: "Needed when it starts" });
    expect(needs).not.toBeChecked();
    await userEvent.click(needs);
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "update", itemId: "i1", needsMaterials: true }));
    await waitFor(() => expect(within(panel).getByRole("switch", { name: "Needed when it starts" })).toBeChecked());
  });

  it("shows work whose materials aren't in yet, and which ones", async () => {
    const fit = { ...drawings, needsMaterials: true };
    mount((url) => (url.includes("/work/i1") ? detail(fit) : board([fit, sheet, marble, handles], { materials: { i1: ["Oak veneer", "Brass handles"] } })));
    plan();
    expect(await screen.findByText("2 materials not in")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Kitchen shop drawings"));
    expect(await within(await screen.findByRole("dialog")).findByText("Not in yet: Oak veneer, Brass handles")).toBeInTheDocument();
  });

  it("shows a snag's severity, source and photos, uploads a photo after, and reopens a closed one only with why", async () => {
    const snag = item({ id: "i9", number: 9, title: "Scratch on the wardrobe door", type: "snag", severity: "critical", source: "client", status: "done", completedAt: "2026-09-27T10:00:00Z", version: 5 });
    const fetcher = mount((url, body) => (url.includes("/work/i9") && !body && !url.includes("/photos/") ? detail(snag, { photos: [{ id: "ph1", kind: "after", name: "fixed.jpg", byName: "Dana Karim", at: "2026-09-27T09:00:00Z" }] })
      : board([drawings, snag], { item: body ? detail({ ...snag, version: 6 }) : null })));
    plan();
    await userEvent.click(await screen.findByText("Scratch on the wardrobe door"));
    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByRole("button", { name: "Critical" })).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Client" })).toBeInTheDocument();
    const photos = within(panel).getByRole("region", { name: "Photos" });
    expect(within(photos).getByRole("img", { name: "fixed.jpg" })).toHaveAttribute("src", expect.stringContaining("/photos/ph1"));
    await userEvent.upload(within(photos).getByLabelText("Add a photo after"), new File(["x"], "after.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(uploads(fetcher)).toEqual([{ url: expect.stringMatching(/\/work\/i9\/photos\/[0-9a-f-]+\?workspaceId=w&kind=after$/), file: expect.objectContaining({ name: "after.jpg" }) }]));

    await userEvent.click(within(panel).getByRole("button", { name: /Done/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "To do" }));
    const dialog = await screen.findByRole("dialog", { name: "Open the snag again" });
    expect(within(dialog).getByRole("button", { name: "Open again" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's open again/ }), "Still visible in daylight");
    await userEvent.click(within(dialog).getByRole("button", { name: "Open again" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "update", itemId: "i9", status: "todo", reason: "Still visible in daylight", version: 5 }));
  });

  it("creates a task given to the person by default", async () => {
    const fetcher = mount((_url, body) => (body ? board([...board().items, item({ id: "i5", number: 5, title: "Site measure" })]) : board()));
    plan();
    await userEvent.click(await screen.findByRole("button", { name: "New task" }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Site measure");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Snag" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([expect.objectContaining({ action: "create", title: "Site measure", type: "snag", assigneeId: "m1", dueDate: null, packageId: null })]));
    expect(posts(fetcher)[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("moves through the list with j and k, searches with / and adds a task with n", async () => {
    mount(() => board());
    plan();
    const table = await screen.findByRole("table", { name: "Plan" }).catch(() => screen.findByRole("grid", { name: "Plan" }));
    const rows = within(table).getAllByRole("row").filter((row) => row.hasAttribute("data-actionable"));
    fireEvent.keyDown(document.body, { key: "j" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: "k" });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: "/" });
    expect(document.activeElement?.tagName).toBe("INPUT");
    // Typing in the search never triggers a shortcut.
    fireEvent.keyDown(document.activeElement!, { key: "n" });
    expect(screen.queryByRole("dialog", { name: "New task" })).toBeNull();
    fireEvent.keyDown(document.body, { key: "n" });
    expect(await screen.findByRole("dialog", { name: "New task" })).toBeInTheDocument();
  });

  it("opens on the snags when another page links to ?type=snag", async () => {
    mount(() => board([drawings, item({ id: "i9", number: 9, title: "Chipped skirting", type: "snag" })]));
    nav.set("type=snag");
    plan();
    expect(await screen.findByText("Chipped skirting")).toBeInTheDocument();
    expect(screen.queryByText("Kitchen shop drawings")).toBeNull();
  });

  it("asks before a date change pushes later work, and moves it only when told to", async () => {
    const dated = { ...drawings, startDate: "2099-10-01", dueDate: "2099-10-10" };
    const fetcher = mount((url, body) => {
      if (url.includes("/ripple")) return { moves: [{ id: "i5", number: 5, title: "Cut list", fromStart: "2099-10-12", fromDue: "2099-10-13", startDate: "2099-10-19", dueDate: "2099-10-20", because: 1 }] };
      if (!body) return url.includes("/work/i1") ? detail(dated) : board([dated, sheet, marble]);
      return board([dated, sheet, marble]);
    });
    nav.set("item=i1");
    plan();
    const dialog = await screen.findByRole("dialog");
    const due = await within(dialog).findByRole("group", { name: "Due" });
    const day = within(due).getAllByRole("spinbutton")[1];
    await userEvent.click(day);
    await userEvent.keyboard("{ArrowUp}");
    const ripple = await screen.findByRole("dialog", { name: "This pushes 1 item later" });
    expect(ripple).toHaveTextContent("#5 Cut list");
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/work/i1/ripple") && String(url).includes("dueDate=2099-10-11"))).toBe(true);
    await userEvent.click(within(ripple).getByRole("button", { name: "Move them too" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "update", itemId: "i1", dueDate: "2099-10-11", ripple: true }));
  });

  it("draws the plan on a timeline and warns when it runs past the handover", async () => {
    nav.set("view=timeline");
    const late = { ...drawings, startDate: "2099-11-25", dueDate: "2099-12-04", baselineStart: "2099-11-20", baselineDue: "2099-11-28" };
    const critical = { finish: "2099-12-04", float: { i1: 0, i2: 5 } };
    mount((url) => (url.includes("/work/i1") ? detail(late) : board([late, { ...sheet, dueDate: "2099-11-26" }, marble, handles], { critical })));
    plan();
    expect(await screen.findByText("The plan ends Dec 4, 2099, 3 days after the handover date.")).toBeInTheDocument();
    const timeline = screen.getByRole("region", { name: "Timeline" });
    expect(within(timeline).getByRole("button", { name: "#1 Kitchen shop drawings" })).toBeInTheDocument();
    expect(within(timeline).getByRole("region", { name: "No dates" })).toHaveTextContent("Marble thickness");
    // The critical path, on request: the drawings have no slack, the sheet can slip.
    await userEvent.click(screen.getByRole("switch", { name: "Critical path" }));
    expect(within(timeline).getByRole("button", { name: "#1 Kitchen shop drawings, on the critical path" })).toBeInTheDocument();
    expect(within(timeline).getByRole("button", { name: "#2 Elevation sheet" })).toBeInTheDocument();
    await userEvent.click(within(timeline).getByRole("button", { name: "#1 Kitchen shop drawings, on the critical path" }));
    expect(nav.get()).toContain("item=i1");
    expect(await screen.findByText("On the critical path")).toBeInTheDocument();
  });

  it("lets the project manager set the baseline", async () => {
    const fetcher = mount((_url, body) => (body ? board(undefined, { baseline: { at: "2026-09-26T10:00:00Z", byName: "Omar Haddad" } }) : board()));
    plan();
    await userEvent.click(await screen.findByRole("button", { name: "Plan actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Set the baseline" }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Set the baseline" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([{ action: "set_baseline" }]));
  });

  it("plans a package from its standard tasks after showing the dates and who does each", async () => {
    const preview: PackagePlan = { package: { id: "k2", name: "Wardrobes", supply: "make" }, startDate: "2099-10-01", planned: false, tasks: [
      { title: "Shop drawings", days: 3, withPrevious: false, startDate: "2099-10-01", dueDate: "2099-10-05", role: "technical_designer", roleLabel: "Technical designer", assigneeId: "m2", assigneeName: "Dana Karim", stageId: "s1", stageName: "Technical drawings" },
      { title: "Production", days: 10, withPrevious: false, startDate: "2099-10-06", dueDate: "2099-10-19", role: "factory_lead", roleLabel: "Factory lead", assigneeId: null, assigneeName: null, stageId: null, stageName: null },
    ] };
    const packages = [{ id: "k1", name: "Kitchen joinery", supply: "make" as const, planned: true }, { id: "k2", name: "Wardrobes", supply: "make" as const, planned: false }];
    const fetcher = mount((url) => (url.includes("/packages/k2/plan") ? preview : board(undefined, { packages })));
    plan();
    await userEvent.click(await screen.findByRole("button", { name: "Plan actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Plan a package" }));
    const dialog = await screen.findByRole("dialog", { name: "Plan a package" });
    expect(await within(dialog).findByText("Shop drawings")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("No factory lead named");
    expect(dialog).toHaveTextContent("Dana Karim");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([{ action: "plan_package", packageId: "k2", startDate: "2099-10-01" }]));
  });

  it("plans sprints: moves backlog work into a sprint and closes the running one with a reason for each miss", async () => {
    nav.set("view=sprints");
    const sprint = (patch: Partial<Sprint>): Sprint => ({ id: "sp1", number: 1, name: "Sprint 1", goal: "Drawings out", startDate: "2099-10-05", endDate: "2099-10-16", status: "active",
      version: 2, items: 2, itemsDone: 1, committed: 2, committedDone: 1, closedAt: null, ...patch });
    const sprints = [sprint({}), sprint({ id: "sp2", number: 2, name: "Sprint 2", goal: "", startDate: "2099-10-19", endDate: "2099-10-30", status: "planned", version: 1, items: 0, itemsDone: 0, committed: 0, committedDone: 0 })];
    const items = [{ ...drawings, sprintId: "sp1", blockedBy: [] }, { ...handles, sprintId: "sp1" }, marble];
    const detail: SprintDetail = { sprint: sprints[0], days: [{ date: "2099-10-05", remaining: 2, ideal: 2 }, { date: "2099-10-06", remaining: 1, ideal: 1.8 }], added: 0, removed: 0, missed: [],
      unfinished: [{ itemId: "i1", number: 1, title: "Kitchen shop drawings" }] };
    const fetcher = mount((url) => (url.includes("/work/sprints/sp1") ? detail : board(items, { sprints })));
    plan();
    const running = await screen.findByRole("region", { name: "Sprint 1" });
    expect(running).toHaveTextContent("Drawings out");
    expect(await within(running).findByRole("img", { name: "Burndown" })).toBeInTheDocument();
    expect(running).toHaveTextContent("1 of 2 committed done");

    const backlog = screen.getByRole("region", { name: "Backlog" });
    await userEvent.click(within(backlog).getByRole("checkbox", { name: "Select #3 Marble thickness" }));
    await userEvent.click(screen.getByRole("button", { name: "Move to" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sprint 2" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "set_sprint", itemIds: ["i3"], sprintId: "sp2" }));

    await userEvent.click(within(running).getByRole("button", { name: "Close sprint" }));
    const dialog = await screen.findByRole("dialog", { name: "Close Sprint 1" });
    const close = within(dialog).getByRole("button", { name: "Close sprint" });
    expect(close).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: /Why #1 wasn't finished/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Waiting on the client" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Note for #1" }), "Away until the 20th");
    await userEvent.click(close);
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "close_sprint", sprintId: "sp1", version: 2, moveTo: "sp2",
      reasons: { i1: { reason: "waiting_on_client", note: "Away until the 20th" } } }));
  });

  it("creates the next sprint two weeks after the last one", async () => {
    nav.set("view=sprints");
    const fetcher = mount(() => board(undefined, { sprints: [{ id: "sp1", number: 1, name: "Sprint 1", goal: "", startDate: "2099-10-05", endDate: "2099-10-16", status: "planned",
      version: 1, items: 0, itemsDone: 0, committed: 0, committedDone: 0, closedAt: null }] }));
    plan();
    await userEvent.click(await screen.findByRole("button", { name: "New sprint" }));
    const dialog = await screen.findByRole("dialog", { name: "New sprint" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Goal" }), "Site ready");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ action: "create_sprint", name: "", goal: "Site ready", startDate: "2099-10-17", endDate: "2099-10-30" }));
  });

  it("shows an empty plan with the first action", async () => {
    mount(() => board([]));
    plan();
    expect(await screen.findByText("No work planned yet")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New task" })).toHaveLength(2);
  });
});

describe("open work", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("groups the person's open work by when it's due, and shows everyone's on request", async () => {
    const rows = (view: string): OpenWorkState => ({ view: view as "mine" | "all", me: "m1", canSeeTeam: false, items: [
      { ...item({ id: "a", number: 7, title: "Approve shop drawings", dueDate: "2020-01-01", assigneeId: "m1", assigneeName: "Omar Haddad" }), projectReference: "PRJ-0007", projectName: "Villa 12" },
      { ...item({ id: "b", number: 2, title: "Book the crane", dueDate: "2099-01-01", assigneeId: "m1", assigneeName: "Omar Haddad" }), projectReference: "PRJ-0008", projectName: "Marina Penthouse" },
      ...(view === "all" ? [{ ...item({ id: "c", number: 3, title: "Paint samples", assigneeId: "m2", assigneeName: "Dana Karim" }), projectReference: "PRJ-0007", projectName: "Villa 12" }] : []),
    ] });
    const fetcher = mount((url) => rows(new URL(url, "http://x").searchParams.get("view") ?? "mine"));
    render(<DesignSystemProvider><OpenWork workspaceId="w" /></DesignSystemProvider>);
    const table = await screen.findByRole("table", { name: "Open work" }).catch(() => screen.findByRole("grid", { name: "Open work" }));
    const text = table.textContent ?? "";
    expect(text.indexOf("Late · 1")).toBeLessThan(text.indexOf("Approve shop drawings"));
    expect(text.indexOf("Later · 1")).toBeLessThan(text.indexOf("Book the crane"));
    expect(table).not.toHaveTextContent("Dana Karim");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Whose work" })).getAllByRole("button").map((tab) => tab.textContent)).toEqual(["Mine", "Everyone"]);
    await userEvent.click(screen.getByRole("button", { name: "Everyone" }));
    expect(await screen.findByText("Paint samples")).toBeInTheDocument();
    expect(fetcher.mock.calls.at(-1)![0]).toContain("view=all");
    await userEvent.type(screen.getByRole("searchbox", { name: "Search work" }), "nothing like this");
    await userEvent.click(await screen.findByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("Paint samples")).toBeInTheDocument();
  });
  it("shows the team's workload and how work went, and opens a person's work", async () => {
    const open: OpenWorkState = { view: "all", me: "m1", canSeeTeam: true, items: [
      { ...item({ id: "a", number: 7, title: "Approve shop drawings", assigneeId: "m2", assigneeName: "Dana Karim" }), projectReference: "PRJ-0007", projectName: "Villa 12" },
      { ...item({ id: "b", number: 8, title: "Book the crane", assigneeId: "m1", assigneeName: "Omar Haddad" }), projectReference: "PRJ-0007", projectName: "Villa 12" }] };
    const row = (patch: Partial<WorkInsights["people"][number]>) => ({ membershipId: "m2", name: "Dana Karim", total: false, open: 4, late: 1, dueThisWeek: 2, blocked: 1, done: 5, doneWithDue: 4, onTime: 3, cycleDays: 2.5, ...patch });
    const insights: WorkInsights = { days: 30, total: row({ membershipId: null, name: null, total: true, open: 6, done: 8, doneWithDue: 8, onTime: 6, cycleDays: 3 }),
      people: [row({}), row({ membershipId: "m1", name: "Omar Haddad", open: 2, late: 0, done: 3, doneWithDue: 0, onTime: 0, cycleDays: null })] };
    const fetcher = mount((url) => (url.includes("/work/insights") ? insights : open));
    render(<DesignSystemProvider><OpenWork workspaceId="w" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "Team" }));
    const table = await screen.findByRole("table", { name: "Team" }).catch(() => screen.findByRole("grid", { name: "Team" }));
    expect(screen.getAllByText("75%")).toHaveLength(2); // Finished on time overall: 6 of 8; and Dana's row
    expect(within(table).getAllByText("75%")).toHaveLength(1); // Dana: 3 of 4; Omar has no due dates, so no percentage
    await userEvent.click(screen.getByRole("radio", { name: "Last 90 days" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("days=90"))).toBe(true));
    await userEvent.click(await within(await screen.findByRole("table", { name: "Team" }).catch(() => screen.findByRole("grid", { name: "Team" }))).findByText("Dana Karim"));
    expect(await screen.findByText("Approve shop drawings")).toBeInTheDocument();
    expect(screen.queryByText("Book the crane")).not.toBeInTheDocument();
  });
});

describe("standard tasks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("edits the standard tasks for a way of delivering a package", async () => {
    const state: SettingsState = {
      settings: { requireAgreement: true, requirePayment: true, requireApproval: false, requireVariationPayment: false, autoFinish: false, clientUpdateAutoSendHours: null, referencePrefix: "PRJ", version: 2,
        roles: [{ key: "project_manager", label: "Project manager" }, { key: "factory_lead", label: "Factory lead" }] },
      templates: [{ id: "r1", name: "Standard", isDefault: true, version: 1, stages: [{ key: "production", name: "Production", ownerRole: "factory_lead", checks: [] }] }],
      workTemplates: [{ supply: "make", version: 3, tasks: [{ title: "Production", days: 15, role: "factory_lead", stage: "production", withPrevious: false }] },
        { supply: "buy", version: 1, tasks: [] }],
      canManage: true,
    };
    const fetcher = mount(() => state);
    render(<DesignSystemProvider><ProjectSettingsPage workspaceId="w" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("radio", { name: "Standard tasks" }).catch(() => screen.findByRole("tab", { name: "Standard tasks" })));
    await userEvent.click(await screen.findByRole("button", { name: /Made in our factory/ }));
    const sheet = await screen.findByRole("dialog", { name: "Made in our factory" });
    const days = within(sheet).getByRole("textbox", { name: "Working days" });
    await userEvent.clear(days);
    await userEvent.type(days, "12");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add task" }));
    const titles = within(sheet).getAllByRole("textbox", { name: "Task" });
    await userEvent.type(titles[1], "Quality check");
    await userEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.find(([url, init]) => String(url).includes("/work-templates/make") && init?.method === "PUT")).toBeTruthy());
    const put = fetcher.mock.calls.find(([url, init]) => String(url).includes("/work-templates/make") && init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toEqual({ version: 3, tasks: [
      { title: "Production", days: 12, role: "factory_lead", stage: "production", withPrevious: false },
      { title: "Quality check", days: 1, role: null, stage: null, withPrevious: false }] });
  });

  it("turns on finishing by itself and sending client updates by themselves after 24 hours (D-7, D-40)", async () => {
    const state: SettingsState = {
      settings: { requireAgreement: true, requirePayment: true, requireApproval: false, requireVariationPayment: false, autoFinish: false, clientUpdateAutoSendHours: null, referencePrefix: "PRJ", version: 2,
        roles: [{ key: "project_manager", label: "Project manager" }] },
      templates: [], workTemplates: [], canManage: true,
    };
    const fetcher = mount(() => state);
    render(<DesignSystemProvider><ProjectSettingsPage workspaceId="w" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("switch", { name: "Finish by itself" }));
    await userEvent.click(screen.getByRole("switch", { name: "Send by itself" }));
    expect(screen.getByRole("button", { name: /After/ })).toHaveTextContent("24 hours");
    await userEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(fetcher.mock.calls.find(([url, init]) => String(url).includes("/settings") && init?.method === "PUT")).toBeTruthy());
    const put = fetcher.mock.calls.find(([url, init]) => String(url).includes("/settings") && init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toMatchObject({ version: 2, autoFinish: true, clientUpdateAutoSendHours: 24 });
  });

  it("sets how every job's client updates start: a call or a portal update, weekly (PLM-179)", async () => {
    const state: SettingsState = {
      settings: { requireAgreement: true, requirePayment: true, requireApproval: false, requireVariationPayment: false, autoFinish: false, clientUpdateAutoSendHours: null, referencePrefix: "PRJ", version: 4,
        roles: [{ key: "project_manager", label: "Project manager" }], clientUpdateMode: "call", clientUpdateFrequency: "weekly" },
      templates: [], workTemplates: [], canManage: true,
    };
    const fetcher = mount(() => state);
    render(<DesignSystemProvider><ProjectSettingsPage workspaceId="w" /></DesignSystemProvider>);
    const updateBy = await screen.findByRole("button", { name: /Update by/ });
    expect(updateBy).toHaveTextContent("Call");
    expect(screen.getByRole("button", { name: /How often/ })).toHaveTextContent("Weekly");
    await userEvent.click(updateBy);
    await userEvent.click(await screen.findByRole("option", { name: "Call or portal update" }));
    await userEvent.click(screen.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(fetcher.mock.calls.find(([url, init]) => String(url).includes("/settings") && init?.method === "PUT")).toBeTruthy());
    const put = fetcher.mock.calls.find(([url, init]) => String(url).includes("/settings") && init?.method === "PUT")!;
    expect(JSON.parse(String(put[1]!.body))).toMatchObject({ version: 4, clientUpdateMode: "either", clientUpdateFrequency: "weekly" });
  });
});
