import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { DayCard as DayCardData, DayIssue, DayReport } from "@/lib/site/types";
import { DayCard } from "./day-card";
import { filterCards, NO_FILTERS } from "./day-feed";

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const report = (patch: Partial<DayReport> = {}): DayReport => ({
  id: "r1", authorId: "u2", authorName: "Sara Supervisor", status: "approved", version: 4, submittedAt: "2026-10-11T14:42:00.000Z", decidedAt: null, decidedByName: "Omar Manager",
  decisionNote: "", late: false, backdated: false, delivery: "pending", sentAt: null, hidden: false, noWorkReason: "", notes: "", clientSummary: "", safety: "none", safetyNote: "",
  forecast: "none", impact: "", recoveryOwnerName: null, recoveryOn: null, waitingFor: [], reactions: { like: 0, love: 0 }, ...patch,
});
const issue = (patch: Partial<DayIssue> = {}): DayIssue => ({
  id: "i1", reportId: "r1", severity: "major", description: "Socket in the wrong place", internal: true, status: "open", ownerId: null, ownerName: null, dueOn: "2026-10-10", overdue: true,
  resolvedAt: null, resolvedByName: null, resolution: "", raised: null, workItemId: null, workItemNumber: null, changeRequestId: null, changeRequestReference: null, version: 2, ...patch,
});
const card = (patch: Partial<DayCardData> = {}): DayCardData => ({
  date: "2026-10-11", status: "approved", clientVisible: false, reports: [report()], people: 5,
  crew: [{ trade: "Carpenters", people: 3, source: "crew_day" }, { trade: "Electricians", people: 2, source: "report" }],
  work: [{ id: "w1", reportId: "r1", kind: "task", title: "Fit carcasses", workItemId: "t1", number: 4, progress: 100, previous: 50, stageId: "s1", stageName: "Carpentry", packageName: null,
    area: null, quantity: null, unit: "", note: "", hidden: false },
  { id: "w2", reportId: "r1", kind: "task", title: "Hang wardrobe doors", workItemId: "t2", number: 5, progress: 60, previous: 20, stageId: "s1", stageName: "Carpentry", packageName: null,
    area: null, quantity: null, unit: "", note: "", hidden: false },
  { id: "w3", reportId: "r1", kind: "task", title: "Skirting", workItemId: "t3", number: 6, progress: 100, previous: 0, stageId: "s1", stageName: "Carpentry", packageName: null,
    area: null, quantity: null, unit: "", note: "", hidden: false },
  { id: "w4", reportId: "r1", kind: "installed", title: "Worktop", workItemId: null, number: null, progress: null, previous: null, stageId: null, stageName: null, packageName: null,
    area: "Kitchen", quantity: "2.2500", unit: "m²", note: "", hidden: false }],
  photos: [{ id: "p1", reportId: "r1", area: "Kitchen", phase: "after", pairId: null, forClient: true, shared: false },
    { id: "p2", reportId: "r1", area: null, phase: null, pairId: null, forClient: false, shared: false }],
  issues: [issue(), issue({ id: "i2", severity: "minor", description: "Chipped tile", status: "resolved", overdue: false, resolvedByName: "Omar Manager", resolution: "Replaced", dueOn: null }),
    issue({ id: "i3", severity: "critical", description: "Column behind the wall", raised: "change_request", changeRequestId: "c1", changeRequestReference: "CR-001", overdue: false, dueOn: null })],
  materials: [{ id: "m1", reportId: "r1", direction: "received", description: "Plywood 18 mm", quantity: "20.0000", unit: "sheet", source: "report", reference: "PO-12" },
    { id: "m2", reportId: null, direction: "used", description: "Tile adhesive", quantity: "4.0000", unit: "bag", source: "stock", reference: null }],
  next: [{ id: "n1", reportId: "r1", title: "Template the worktop", workItemId: null, hidden: false }], stageIds: ["s1"], trades: ["Carpenters", "Electricians"], ...patch,
});
const photoUrl = (id: string) => `/photos/${id}`;
const show = (node: React.ReactNode) => render(<DesignSystemProvider timeZone="UTC">{node}</DesignSystemProvider>);

describe("day card", () => {
  it("reads the whole day: photos, work done with its stage, issues with owner and due, crew, materials and next", () => {
    show(<DayCard card={card()} projectId={PID} photoUrl={photoUrl} me="u1" />);
    const day = screen.getByRole("article", { name: /Site day/ });
    expect(within(day).getByText("Approved")).toBeInTheDocument();
    expect(within(day).getAllByRole("button", { name: /Open photo/ })).toHaveLength(2);
    expect(within(day).getByText("Fit carcasses")).toBeInTheDocument();
    expect(within(day).getByText("60% · Carpentry")).toBeInTheDocument();
    expect(within(day).getByText("Worktop: 2.25 m² installed")).toBeInTheDocument();
    // Open issues first, the overdue one marked; a resolved one says who and how; a raised one links to its change.
    expect(within(day).getByText(/^No owner · Due /)).toHaveAttribute("data-overdue");
    expect(within(day).getByText("Resolved by Omar Manager · Replaced")).toBeInTheDocument();
    expect(within(day).getByRole("link", { name: "CR-001" })).toHaveAttribute("href", `/workspace/projects/${PID}/changes/c1`);
    expect(within(day).getByText("Carpenters 3")).toBeInTheDocument();
    expect(within(day).getByText("5 on site")).toBeInTheDocument();
    expect(within(day).getByText("Received · Plywood 18 mm · 20 sheet")).toBeInTheDocument();
    expect(within(day).getByText("From stock")).toBeInTheDocument();
    expect(within(day).getByText("Template the worktop")).toBeInTheDocument();
  });

  it("opens the photos full size, one after another", async () => {
    show(<DayCard card={card()} projectId={PID} photoUrl={photoUrl} />);
    await userEvent.click(screen.getByRole("button", { name: "Open photo 1" }));
    const viewer = await screen.findByRole("dialog");
    expect(within(viewer).getByText("Kitchen · After · 1 of 2")).toBeInTheDocument();
    await userEvent.click(within(viewer).getByRole("button", { name: "Next photo" }));
    expect(within(viewer).getByText("2 of 2")).toBeInTheDocument();
  });

  it("resolves an issue with how, gives it an owner, and turns one into a snag in one tap", async () => {
    const command = vi.fn(async () => true);
    show(<DayCard card={card()} projectId={PID} photoUrl={photoUrl} me="u1" onTeam canManage members={[{ membershipId: "m2", name: "Sara Supervisor" }]} onCommand={command} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Resolve" })[0]);
    const resolve = await screen.findByRole("dialog", { name: "Resolve issue" });
    await userEvent.type(within(resolve).getByRole("textbox", { name: /How it was resolved/ }), "Moved by the electrician");
    await userEvent.click(within(resolve).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith("update_issue", { issueId: "i1", version: 2, status: "resolved", resolution: "Moved by the electrician" }));
    await userEvent.click(screen.getByRole("button", { name: "More for Socket in the wrong place" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Raise a snag" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith("raise_issue", { issueId: "i1", kind: "snag" }));
    // An issue already raised offers no second record.
    await userEvent.click(screen.getByRole("button", { name: "More for Column behind the wall" }));
    expect(screen.queryByRole("menuitem", { name: "Raise a change request" })).not.toBeInTheDocument();
  });

  it("lets the project manager choose whether the client sees an approved day", async () => {
    const command = vi.fn(async () => true);
    show(<DayCard card={card()} projectId={PID} photoUrl={photoUrl} me="u1" canManage canApprove onCommand={command} onOpenReport={() => undefined} />);
    await userEvent.click(screen.getByRole("switch", { name: "Client sees this" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith("set_client_visibility", { reportId: "r1", version: 4, visible: true }));
  });

  it("is compact on the Overview and Home: the day, a few photos, the first work and a way to the whole card", () => {
    show(<DayCard card={card({ photos: Array.from({ length: 6 }, (_, at) => ({ id: `p${at}`, reportId: "r1", area: null, phase: null, pairId: null, forClient: false, shared: false })) })}
      projectId={PID} photoUrl={photoUrl} density="compact" href={`/workspace/projects/${PID}/site?day=2026-10-11`} />);
    const day = screen.getByRole("article");
    expect(within(day).getAllByRole("button", { name: /Open photo/ })).toHaveLength(4);
    expect(within(day).getByText("+2")).toBeInTheDocument();
    expect(within(day).getByText("1 more")).toBeInTheDocument();
    expect(within(day).getByText("2 open issues")).toBeInTheDocument();
    expect(within(day).queryByText("Plywood 18 mm", { exact: false })).not.toBeInTheDocument();
    expect(within(day).getByRole("link", { name: "Open" })).toHaveAttribute("href", `/workspace/projects/${PID}/site?day=2026-10-11`);
  });

  it("filters by stage, trade, issues and what waits for my review", () => {
    const cards = [card(), card({ date: "2026-10-10", stageIds: [], trades: ["Painters"], issues: [], status: "submitted", reports: [report({ id: "r9", status: "submitted" })] })];
    const reviewable = (item: DayReport) => item.status === "submitted" && item.authorId !== "u1";
    expect(filterCards(cards, NO_FILTERS, reviewable)).toHaveLength(2);
    expect(filterCards(cards, { ...NO_FILTERS, stage: "s1" }, reviewable).map((item) => item.date)).toEqual(["2026-10-11"]);
    expect(filterCards(cards, { ...NO_FILTERS, trade: "painters" }, reviewable).map((item) => item.date)).toEqual(["2026-10-10"]);
    expect(filterCards(cards, { ...NO_FILTERS, issues: true }, reviewable).map((item) => item.date)).toEqual(["2026-10-11"]);
    expect(filterCards(cards, { ...NO_FILTERS, review: true }, reviewable).map((item) => item.date)).toEqual(["2026-10-10"]);
  });
});
