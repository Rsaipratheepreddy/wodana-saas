import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { SiteReport, SiteState } from "@/lib/site/types";
import { ProjectSite } from "./project-site";

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const report = (patch: Partial<SiteReport> = {}): SiteReport => ({
  id: "r1", reportDate: "2026-09-25", authorId: "u2", authorName: "Dana Karim", status: "submitted", weather: "Hot", safety: "none", safetyNote: "", forecast: "none", impact: "",
  recoveryOwnerId: null, recoveryOwnerName: null, recoveryOn: null, noWorkReason: "", notes: "", decidedByName: null, decisionNote: "", version: 3,
  workforce: [{ trade: "Carpenters", people: 4 }], lines: [{ id: "e1", boqLineId: "l1", title: "Kitchen cabinets", unit: "m", installed: "3.0000", note: "" }],
  photos: [{ id: "ph1", name: "kitchen.jpg" }], ...patch,
});
const state = (patch: Partial<SiteState> = {}): SiteState => ({
  site: { startedOn: "2026-09-21", finishedOn: null }, reports: [report()],
  lines: [{ id: "l1", title: "Kitchen cabinets", unit: "m", quantity: "4.5000", supply: "buy", catalogItemId: null, areaName: "Kitchen", installed: "0.0000", pending: "3.0000" }],
  members: [{ membershipId: "m1", name: "Omar Haddad" }], today: "2026-09-27", me: "u1", canReport: true, canApprove: true, canManage: true, ...patch,
});
const mount = (respond: (url: string, init?: RequestInit) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, init);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && typeof init.body === "string").map(([, init]) => JSON.parse(String(init!.body)));
const uploads = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST" && init.body instanceof FormData).map(([url]) => String(url));
const site = () => render(<DesignSystemProvider><ProjectSite workspaceId="w" projectId={PID} /></DesignSystemProvider>);

describe("site", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("shows reports waiting for approval and approves one, or sends it back with what to change", async () => {
    const fetcher = mount(() => state());
    site();
    const waiting = await screen.findByRole("region", { name: "Waiting for your approval" });
    expect(within(waiting).getByText("Carpenters 4")).toBeInTheDocument();
    expect(within(waiting).getByText("Kitchen cabinets: 3 m installed")).toBeInTheDocument();
    expect(within(waiting).getByRole("img", { name: "kitchen.jpg" })).toBeInTheDocument();
    await userEvent.click(within(waiting).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "approve", reportId: "r1", version: 3 }));
    await userEvent.click(within(waiting).getByRole("button", { name: "Send back" }));
    const dialog = await screen.findByRole("dialog", { name: "Send the report back" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What to change/ }), "Only 3 m arrived");
    await userEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toEqual({ action: "return", reportId: "r1", note: "Only 3 m arrived", version: 3 }));
  });

  it("writes the day's report: who worked, what was installed and a photo, then submits it", async () => {
    let saved: SiteReport | null = null;
    const fetcher = mount((_url, init) => {
      if (init?.method === "POST" && typeof init.body === "string") {
        const body = JSON.parse(init.body);
        if (body.action === "save_report") saved = report({ id: body.id, authorId: "u1", status: "draft", version: 1, photos: [] });
        if (body.action === "submit" && saved) saved = { ...saved, status: "submitted" };
      }
      return state({ reports: saved ? [saved] : [] });
    });
    site();
    await userEvent.click(await screen.findByRole("button", { name: "New report" }));
    const dialog = await screen.findByRole("dialog", { name: "New report" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Trade" }), "Carpenters");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "People" }), "4");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add an item" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Item/ }));
    await userEvent.click(await screen.findByRole("option", { name: /Kitchen cabinets · Kitchen/ }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Quantity installed" }), "3");
    // Evidence first: a photo, or why no work was done.
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeDisabled();
    await userEvent.upload(within(dialog).getByLabelText("Add photos"), new File(["x"], "kitchen.jpg", { type: "image/jpeg" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(posts(fetcher).map((body) => body.action)).toEqual(["save_report", "submit"]));
    expect(posts(fetcher)[0]).toMatchObject({ reportDate: "2026-09-27", workforce: [{ trade: "Carpenters", people: 4 }], lines: [{ boqLineId: "l1", installed: "3", note: "" }] });
    expect(uploads(fetcher)).toEqual([expect.stringMatching(/\/reports\/[0-9a-f-]+\/photos\/[0-9a-f-]+\?workspaceId=w$/)]);
  });

  it("asks who recovers a blocked day and by when, and what happened in an incident", async () => {
    mount(() => state({ reports: [] }));
    site();
    await userEvent.click(await screen.findByRole("button", { name: "New report" }));
    const dialog = await screen.findByRole("dialog", { name: "New report" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "If no work was done, why" }), "Waiting for tiles");
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole("button", { name: /Outlook/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Blocked" }));
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(within(dialog).getByRole("textbox", { name: /What's at risk/ })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /Safety/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Incident" }));
    expect(within(dialog).getByRole("textbox", { name: /What happened/ })).toBeInTheDocument();
  });
});
