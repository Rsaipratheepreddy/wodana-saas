import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ClientView, SiteReport, SiteState } from "@/lib/site/types";
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
const state = (patch: Partial<SiteState> = {}): SiteState => ({
  site: { startedOn: "2026-09-21", finishedOn: null }, reports: [report()],
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

  it("shows the days on a timeline with their state, late and missing days, and the ones waiting for review first", async () => {
    mount(() => state({ reports: [report(), report({ id: "r2", reportDate: "2026-09-23", status: "approved", delivery: "sent", late: false, version: 5, reactions: { like: 1, love: 2 } }),
      report({ id: "r3", reportDate: "2026-09-26", authorId: "u1", status: "returned", decisionNote: "Add the kitchen photo", decidedByName: "Omar Haddad", late: false })] }));
    site();
    const waiting = await screen.findByRole("region", { name: "Waiting for your review" });
    expect(within(waiting).getByText("Submitted")).toBeInTheDocument();
    expect(within(waiting).getByText("Late")).toBeInTheDocument();
    expect(within(waiting).getByText("The kitchen carcasses are in.")).toBeInTheDocument();
    expect(within(waiting).getByRole("button", { name: "Review" })).toBeInTheDocument();
    const timeline = screen.getByRole("region", { name: "Daily progress" });
    expect(within(timeline).getByText("Sent")).toBeInTheDocument();
    expect(within(timeline).getByText("Returned")).toBeInTheDocument();
    expect(within(timeline).getByText("Sent back by Omar Haddad: Add the kitchen photo")).toBeInTheDocument();
    expect(within(timeline).getByText("No report")).toBeInTheDocument();
    expect(within(timeline).getByRole("button", { name: "Continue" })).toBeInTheDocument();
    // Only an approved day prints: its client's card as a PDF.
    expect(within(timeline).getAllByRole("link", { name: "Download PDF" }).map((link) => link.getAttribute("href"))).toEqual([`/print/daily/r2?workspaceId=w&projectId=${PID}`]);
    expect(within(waiting).queryByRole("link", { name: "Download PDF" })).not.toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole("button", { name: "Today's report" }));
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

  it("asks who recovers a blocked day and by when, and what happened in an incident", async () => {
    mount(() => state({ reports: [] }));
    site();
    await userEvent.click(await screen.findByRole("button", { name: "Today's report" }));
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
});
