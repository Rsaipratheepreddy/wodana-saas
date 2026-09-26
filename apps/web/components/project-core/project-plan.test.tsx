import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { OpenWork as OpenWorkState, WorkBoard, WorkDetail, WorkItem } from "@/lib/project-core/types";
import { OpenWork } from "./open-work";
import { ProjectPlan } from "./project-plan";

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
  projectId: PID, type: "task", parentId: null, packageId: null, boqLineId: null, stageId: null, status: "todo", priority: "normal",
  assigneeId: null, assigneeName: null, startDate: null, dueDate: null, completedAt: null, createdBy: "u1", version: 1,
  subtasks: 0, subtasksDone: 0, comments: 0, blockedBy: [], ...patch,
});
const drawings = item({ id: "i1", number: 1, title: "Kitchen shop drawings", packageId: "k1", assigneeId: "m2", assigneeName: "Dana Karim", dueDate: "2099-10-10", priority: "high", subtasks: 1,
  blockedBy: [{ id: "i3", number: 3, title: "Marble thickness", type: "blocker", status: "todo" }], version: 3 });
const sheet = item({ id: "i2", number: 2, title: "Elevation sheet", packageId: "k1", parentId: "i1" });
const marble = item({ id: "i3", number: 3, title: "Marble thickness", type: "blocker", assigneeId: "m1", assigneeName: "Omar Haddad" });
const handles = item({ id: "i4", number: 4, title: "Order handles", status: "done", completedAt: "2026-09-20T10:00:00Z" });
const board = (items: WorkItem[] = [drawings, sheet, marble, handles], extra: Partial<WorkBoard> = {}): WorkBoard => ({
  items, packages: [{ id: "k1", name: "Kitchen joinery" }], stages: [{ id: "s1", name: "Technical drawings", status: "current" }], lines: [],
  people: [{ membershipId: "m1", name: "Omar Haddad" }, { membershipId: "m2", name: "Dana Karim" }], me: "m1", canEdit: true, item: null, ...extra,
});
const detail = (base: WorkItem, patch: Partial<WorkDetail> = {}): WorkDetail => ({
  ...base, description: "", createdByName: "Omar Haddad", createdAt: "2026-09-22T09:00:00Z", startedAt: null, subtaskIds: base.id === "i1" ? ["i2"] : [],
  before: base.id === "i1" ? [{ ...marble, kind: "fs", lagDays: 0 }] : [], after: [],
  activity: [{ id: "e1", kind: "created", detail: {}, by: "Omar Haddad", at: "2026-09-22T09:00:00Z" }, { id: "c1", kind: "comment", body: "Waiting on the marble.", by: "Dana Karim", at: "2026-09-23T09:00:00Z" }],
  ...patch,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));
const plan = () => render(<DesignSystemProvider><ProjectPlan workspaceId="w" projectId={PID} /></DesignSystemProvider>);

describe("project plan", () => {
  beforeEach(() => nav.set(""));
  afterEach(() => vi.unstubAllGlobals());

  it("lists open work by package with subtasks under their task, done work last, and filters to mine", async () => {
    mount(() => board());
    plan();
    const table = await screen.findByRole("table", { name: "Plan" }).catch(() => screen.findByRole("grid", { name: "Plan" }));
    const text = table.textContent ?? "";
    expect(text.indexOf("Kitchen joinery · 1")).toBeLessThan(text.indexOf("Kitchen shop drawings"));
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
    const rows = (view: string): OpenWorkState => ({ view: view as "mine" | "all", me: "m1", items: [
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
    await userEvent.click(screen.getByRole("radio", { name: "Everyone" }));
    expect(await screen.findByText("Paint samples")).toBeInTheDocument();
    expect(fetcher.mock.calls.at(-1)![0]).toContain("view=all");
  });
});
