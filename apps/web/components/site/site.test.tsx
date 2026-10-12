import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ClientView, DayCard, SiteReport, SiteState } from "@/lib/site/types";
import { ProjectSite } from "./project-site";

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const report = (patch: Partial<SiteReport> = {}): SiteReport => ({
  id: "r1", reportDate: "2026-09-25", authorId: "u2", authorName: "Dana Karim", status: "submitted", weather: "Hot", safety: "none", safetyNote: "", forecast: "none", impact: "",
  recoveryOwnerId: null, recoveryOwnerName: null, recoveryOn: null, noWorkReason: "", notes: "Crew lead left early", decidedByName: null, decisionNote: "", version: 3, waitingFor: ["Maya Haddad"],
  workforce: [{ trade: "Carpenters", people: 4, hours: "8.00" }], lines: [{ id: "e1", boqLineId: "l1", title: "Kitchen cabinets", unit: "m", installed: "3.0000", note: "" }],
  photos: [{ id: "ph1", name: "kitchen.jpg", forClient: true, areaId: "a1", phase: "after", pairId: null }], late: true, delivery: "pending",
  clientSummary: "The kitchen carcasses are in.", summarySource: "template", heroPhotoId: "ph1",
  tasks: [{ id: "st1", workItemId: "t1", number: 7, title: "Fit kitchen carcasses", progress: 100, previous: 50, note: "", hidden: false }],
  next: [{ id: "sn1", workItemId: "t2", title: "Template the worktop", hidden: false }], materials: [], issues: [], reactions: { like: 0, love: 0 }, ...patch,
});
/** A report's day card, as the server reads it. */
export const cardOf = (item: SiteReport, patch: Partial<DayCard> = {}): DayCard => ({
  date: item.reportDate, status: item.status, clientVisible: item.delivery === "sent" && !item.clientHidden,
  reports: [{ id: item.id, authorId: item.authorId, authorName: item.authorName, status: item.status, version: item.version, submittedAt: "2026-09-25T15:42:00.000Z", decidedAt: null,
    decidedByName: item.decidedByName, decisionNote: item.decisionNote, late: Boolean(item.late), backdated: false, delivery: item.delivery ?? "pending", sentAt: null, hidden: Boolean(item.clientHidden),
    noWorkReason: item.noWorkReason, notes: item.notes, clientSummary: item.clientSummary ?? "", safety: item.safety, safetyNote: item.safetyNote, forecast: item.forecast, impact: item.impact,
    recoveryOwnerName: item.recoveryOwnerName, recoveryOn: item.recoveryOn, waitingFor: item.waitingFor, reactions: item.reactions ?? { like: 0, love: 0 } }],
  crew: item.workforce.map((row) => ({ trade: row.trade, people: row.people, source: "report" as const })), people: item.workforce.reduce((sum, row) => sum + row.people, 0),
  work: [...(item.tasks ?? []).map((task) => ({ id: task.id, reportId: item.id, kind: "task" as const, title: task.title, workItemId: task.workItemId, number: task.number, progress: task.progress,
    previous: task.previous, stageId: "s1", stageName: "Carpentry", packageName: null, area: null, quantity: null, unit: "", note: task.note, hidden: task.hidden })),
  ...item.lines.map((line) => ({ id: line.id, reportId: item.id, kind: "installed" as const, title: line.title, workItemId: null, number: null, progress: null, previous: null, stageId: null, stageName: null,
    packageName: null, area: "Kitchen", quantity: line.installed, unit: line.unit, note: line.note, hidden: false }))],
  photos: item.photos.map((photo) => ({ id: photo.id, reportId: item.id, area: "Kitchen", phase: photo.phase ?? null, pairId: null, forClient: Boolean(photo.forClient), shared: false })),
  issues: [], materials: [], next: (item.next ?? []).map((entry) => ({ id: entry.id, reportId: item.id, title: entry.title, workItemId: entry.workItemId, hidden: entry.hidden })),
  stageIds: (item.tasks ?? []).length ? ["s1"] : [], trades: item.workforce.map((row) => row.trade), ...patch,
});
const state = (patch: Partial<SiteState> = {}): SiteState => ({
  site: { startedOn: "2026-09-21", finishedOn: null }, reports: [report()],
  days: { from: "2026-08-31", to: "2026-09-27", today: "2026-09-27", cards: (patch.reports ?? [report()]).map((item) => cardOf(item)), missing: patch.missing ?? ["2026-09-24"],
    stages: [{ id: "s1", name: "Carpentry" }], trades: ["Carpenters"] },
  lines: [{ id: "l1", title: "Kitchen cabinets", unit: "m", quantity: "4.5000", supply: "buy", catalogItemId: null, areaName: "Kitchen", installed: "0.0000", pending: "3.0000" }],
  members: [{ membershipId: "m1", name: "Omar Haddad" }], today: "2026-09-27", me: "u1", canReport: true, canApprove: true, canManage: true, dueTime: "18:00",
  plan: { today: [{ id: "t1", number: 7, title: "Fit kitchen carcasses", status: "in_progress", progress: 50, startDate: "2026-09-25", dueDate: "2026-09-26", overdue: true, packageName: "Kitchen", assigneeName: null }],
    tomorrow: { day: "2026-09-28", tasks: [{ id: "t1", title: "Fit kitchen carcasses" }, { id: "t2", title: "Template the worktop" }] } },
  areas: [{ id: "a1", name: "Kitchen" }], deliveries: [], crew: [{ trade: "Carpenters", people: 3, hours: "8.00" }], missing: ["2026-09-24"], ...patch,
});
const view: ClientView = {
  reportId: "r1", date: "2026-09-25", project: { name: "Villa 12", reference: "PRJ-7", stage: "Carpentry", stageNumber: 3, stageCount: 6, progress: 42, handoverDate: "2026-11-01", daysToHandover: 37 },
  brand: { name: "Studio", logoUrl: null, accentColor: null }, summary: "The kitchen carcasses are in.", noWork: false, hero: { id: "ph1", area: "Kitchen", phase: "after", pairId: null }, photos: [],
  completed: ["Fit kitchen carcasses"], advanced: [], next: ["Template the worktop"], notes: [],
};
const mount = (respond: (url: string, init?: RequestInit) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = String(url).includes("/client-view") ? { view, sent: false } : respond(url, init);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && typeof init.body === "string").map(([, init]) => JSON.parse(String(init!.body)));
const uploads = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && init.body instanceof FormData).map(([url]) => String(url));
const site = () => render(<DesignSystemProvider timeZone="UTC"><ProjectSite workspaceId="w" projectId={PID} /></DesignSystemProvider>);

describe("daily progress", () => {
  beforeEach(() => { vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:photo"), revokeObjectURL: vi.fn() })); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows a clean card per day, newest first, with missed working days marked and each report's one action", async () => {
    mount(() => state({ reports: [report(), report({ id: "r2", reportDate: "2026-09-23", status: "approved", delivery: "sent", late: false, version: 5, reactions: { like: 1, love: 2 } }),
      report({ id: "r3", reportDate: "2026-09-26", authorId: "u1", status: "returned", decisionNote: "Add the kitchen photo", decidedByName: "Omar Haddad", late: false })] }));
    site();
    const feed = await screen.findByRole("list", { name: "Daily progress" });
    const days = within(feed).getAllByRole("listitem").filter((item) => item.parentElement === feed);
    // 26 Sep (returned), 25 Sep (to review), 24 Sep (no report), 23 Sep (sent).
    expect(days.map((item) => item.querySelector("time")?.getAttribute("datetime"))).toEqual(["2026-09-26", "2026-09-25", "2026-09-24", "2026-09-23"]);
    const toReview = within(days[1]).getByRole("article");
    expect(within(toReview).getByText("To review")).toBeInTheDocument();
    expect(within(toReview).getByText("Late")).toBeInTheDocument();
    expect(within(toReview).getByText("Fit kitchen carcasses")).toBeInTheDocument();
    expect(within(toReview).getByText("Kitchen cabinets: 3 m installed")).toBeInTheDocument();
    expect(within(toReview).getByText("Carpenters 4")).toBeInTheDocument();
    expect(within(toReview).getByText("Template the worktop")).toBeInTheDocument();
    expect(within(toReview).getByText("Crew lead left early")).toBeInTheDocument();
    expect(within(toReview).getByRole("button", { name: "Review" })).toBeInTheDocument();
    expect(within(days[0]).getByText("Sent back by Omar Haddad: Add the kitchen photo")).toBeInTheDocument();
    expect(within(days[0]).getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(within(days[2]).getByText("No report")).toBeInTheDocument();
    expect(within(days[3]).getAllByText("Client sees this").length).toBeGreaterThan(0);
  });

  it("filters the days by stage, trade, issues and what waits for my review; a missed day takes a report for that day", async () => {
    const fetcher = mount(() => state({ reports: [report(), report({ id: "r2", reportDate: "2026-09-23", status: "approved", late: false, tasks: [], workforce: [{ trade: "Painters", people: 2 }] })] }));
    site();
    const feed = await screen.findByRole("list", { name: "Daily progress" });
    await userEvent.click(screen.getByRole("switch", { name: "To review (1)" }));
    expect(within(feed).getAllByRole("article")).toHaveLength(1);
    // Filtering hides the missed-day markers.
    expect(within(feed).queryByText("No report")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(within(screen.getByRole("list", { name: "Daily progress" })).getAllByRole("article")).toHaveLength(2);
    await userEvent.click(screen.getByRole("switch", { name: "With issues" }));
    expect(await screen.findByText("No days match")).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    await userEvent.click(within(screen.getByRole("list", { name: "Daily progress" })).getByRole("button", { name: "Add report" }));
    const dialog = await screen.findByRole("dialog", { name: "Today's report" });
    expect(within(dialog).getByRole("group", { name: "Day" })).toHaveTextContent("24");
    void fetcher;
  });

  it("offers the Access view only to someone who may see who is allowed on site (m14)", async () => {
    mount(() => state({ canSeeSiteAccess: false }));
    const { unmount } = site();
    await screen.findByRole("list", { name: "Daily progress" });
    expect(screen.getByRole("radio", { name: "Deliveries" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Access" })).not.toBeInTheDocument();
    unmount();
    mount(() => state({ canSeeSiteAccess: true }));
    site();
    expect(await screen.findByRole("radio", { name: "Access" })).toBeInTheDocument();
  });

  it("reviews a day beside the client's card and approves & sends it, or returns it with what to change", async () => {
    const fetcher = mount(() => state());
    site();
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog", { name: /2026 · Dana Karim$/ });
    // Exactly what the client gets, and what stays inside.
    const preview = within(dialog).getByRole("region", { name: "What the client gets" });
    expect(await within(preview).findByText("The kitchen carcasses are in.")).toBeInTheDocument();
    expect(within(preview).getByText("Template the worktop")).toBeInTheDocument();
    expect(within(preview).queryByText(/Crew lead/)).not.toBeInTheDocument();
    // The client doesn't need to see the carcasses: hidden in one tap.
    await userEvent.click(within(dialog).getByRole("switch", { name: "Fit kitchen carcasses · done" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "review", reportId: "r1", version: 3, tasks: [{ id: "st1", hidden: true }] }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Approve & send" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "approve_send", reportId: "r1", version: 3 }));
  });

  it("returns a day to the supervisor with what to change", async () => {
    const fetcher = mount(() => state());
    site();
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    const dialog = await screen.findByRole("dialog", { name: /2026 · Dana Karim$/ });
    await userEvent.click(within(dialog).getByRole("button", { name: "Return to supervisor" }));
    const note = await screen.findByRole("dialog", { name: "Return to supervisor" });
    await userEvent.type(within(note).getByRole("textbox", { name: /What to change/ }), "Only 3 m arrived");
    await userEvent.click(within(note).getByRole("button", { name: "Return" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "return", reportId: "r1", version: 3, note: "Only 3 m arrived" }));
  });

  it("writes today's report from the plan: one tap per task, yesterday's crew, a photo by room, then submits", async () => {
    let saved: SiteReport | null = null;
    const fetcher = mount((_url, init) => {
      if (init?.method === "POST" && typeof init.body === "string") {
        const body = JSON.parse(init.body);
        if (body.action === "save_report") saved = report({ id: body.id, authorId: "u1", status: "draft", version: (saved?.version ?? 0) + 1, photos: saved?.photos ?? [], tasks: [], next: [] });
        if (body.action === "submit" && saved) saved = { ...saved, status: "submitted" };
      }
      if (init?.body instanceof FormData && saved) saved = { ...saved, version: saved.version + 1, photos: [{ id: "p-new", name: "kitchen.jpg", forClient: false, areaId: null, phase: null, pairId: null }] };
      return state({ reports: saved ? [saved] : [] });
    });
    site();
    await userEvent.click(await screen.findByRole("button", { name: "Add today's report" }));
    const dialog = await screen.findByRole("dialog", { name: "Today's report" });
    // Yesterday's crew is ready, and the plan's work for today is one tap each.
    expect(within(dialog).getByRole("textbox", { name: "Trade" })).toHaveValue("Carpenters");
    expect(within(dialog).getByText("Late")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("radio", { name: "Done" }));
    // Evidence first: a photo, or why no work was done.
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeDisabled();
    await userEvent.upload(within(dialog).getByLabelText("Add photos"), new File(["x"], "kitchen.jpg", { type: "image/jpeg" }));
    await waitFor(() => expect(uploads(fetcher)).toEqual([expect.stringMatching(/\/reports\/[0-9a-f-]+\/photos\/[0-9a-f-]+\?workspaceId=w$/)]));
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(posts(fetcher).map((body) => body.action)).toContain("submit"));
    const first = posts(fetcher).find((body) => body.action === "save_report");
    expect(first).toMatchObject({ reportDate: "2026-09-27", workforce: [{ trade: "Carpenters", people: 3, hours: 8 }], tasks: [{ workItemId: "t1", progress: 100, note: "" }],
      // Finished today, so it isn't tomorrow's work.
      next: [{ workItemId: "t2", title: "Template the worktop" }] });
  });

  it("puts the cursor in the new Tomorrow line, and Enter starts the next one (m17)", async () => {
    mount(() => state({ reports: [] }));
    site();
    await userEvent.click(await screen.findByRole("button", { name: "Add today's report" }));
    const dialog = await screen.findByRole("dialog", { name: "Today's report" });
    const tomorrow = within(dialog).getByRole("group", { name: "Tomorrow" });
    const before = within(tomorrow).queryAllByRole("textbox", { name: "Planned for tomorrow" }).length;
    await userEvent.click(within(tomorrow).getByRole("button", { name: "Add" }));
    const added = within(tomorrow).getAllByRole("textbox", { name: "Planned for tomorrow" });
    expect(added).toHaveLength(before + 1);
    expect(added.at(-1)).toHaveFocus();
    await userEvent.keyboard("Fit the worktop{Enter}");
    expect(added.at(-1)).toHaveValue("Fit the worktop");
    const lines = within(tomorrow).getAllByRole("textbox", { name: "Planned for tomorrow" });
    expect(lines).toHaveLength(before + 2);
    expect(lines.at(-1)).toHaveFocus();
  });

  it("asks who recovers a blocked day and by when, and what happened in an incident", async () => {
    mount(() => state({ reports: [] }));
    site();
    await userEvent.click(await screen.findByRole("button", { name: "Add today's report" }));
    const dialog = await screen.findByRole("dialog", { name: "Today's report" });
    await userEvent.click(within(dialog).getByRole("switch", { name: "No work today" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why/ }), "Waiting for tiles");
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole("button", { name: /More details/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Outlook/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Blocked" }));
    expect(within(dialog).getByRole("textbox", { name: /What's at risk/ })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Safety/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Incident" }));
    expect(within(dialog).getByRole("textbox", { name: /What happened/ })).toBeInTheDocument();
  });

  it("PLM-065: finishing site work with the balance before installation owed lists what's owed; only someone who manages projects signs it off, with why", async () => {
    const owed = { stages: [{ id: "p2", title: "Balance before installation", amount: "25000.00", currency: "AED", state: "invoiced" as const }], totals: [{ currency: "AED", amount: "25000.00" }] };
    let fetcher = mount(() => state({ installationOwed: owed, canSignOffOwed: false }));
    const view = site();
    await userEvent.click(await screen.findByRole("button", { name: "Finish site work" }));
    let dialog = await screen.findByRole("dialog", { name: "Finish site work" });
    expect(within(dialog).getByText("Balance before installation")).toBeInTheDocument();
    expect(within(dialog).getByText("Invoiced")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open payments" })).toHaveAttribute("href", `/workspace/projects/${PID}/money?view=client`);
    expect(within(dialog).queryByRole("button", { name: "Finish site work" })).not.toBeInTheDocument();
    expect(posts(fetcher)).toEqual([]);
    view.unmount();

    fetcher = mount((url, init) => init?.method === "POST" ? state({ site: { startedOn: "2026-09-21", finishedOn: "2026-09-27" }, installationOwed: null }) : state({ installationOwed: owed, canSignOffOwed: true }));
    site();
    await userEvent.click(await screen.findByRole("button", { name: "Finish site work" }));
    dialog = await screen.findByRole("dialog", { name: "Finish site work" });
    expect(within(dialog).getByRole("button", { name: "Finish site work" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's signed off before it's paid/ }), "Owner agreed: paid on handover");
    await userEvent.click(within(dialog).getByRole("button", { name: "Finish site work" }));
    await waitFor(() => expect(posts(fetcher)).toEqual([expect.objectContaining({ action: "finish_site", on: "2026-09-27", owedReason: "Owner agreed: paid on handover" })]));
  });
});
