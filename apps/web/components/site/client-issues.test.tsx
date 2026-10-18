import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { StaffIssue } from "@/lib/client-portal/types";
import type { SiteState } from "@/lib/site/types";
import { ProjectSite } from "./project-site";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const CASE = "8a0e6d7c-3b2a-4f1e-8d9c-0a1b2c3d4e5f";
const issue = (patch: Partial<StaffIssue> = {}): StaffIssue => ({
  id: "i1", number: 3, raisedOn: "2026-09-26", description: "Chipped edge on the kitchen island", area: "Kitchen", areaId: "a1", status: "to_triage", severity: null, reason: "",
  by: "Aisha Al Mansoori", snagId: null, version: 1, decidedBy: null, files: [{ id: "f1", name: "chip.jpg", mimeType: "image/jpeg", hasPreview: true }], ...patch,
});
const site: SiteState = {
  site: { startedOn: "2026-09-21", finishedOn: null }, reports: [], lines: [], members: [], today: "2026-09-27", me: "u1", canReport: true, canApprove: true, canManage: true,
};
const mount = (issues: () => StaffIssue[], canTriage = true) => {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async (url) => ({ ok: true, status: 200,
    json: async () => (String(url).startsWith("/api/client-portal-admin/") ? { issues: issues(), caseId: CASE, canTriage } : site) }));
  vi.stubGlobal("fetch", fetcher);
  render(<DesignSystemProvider><ProjectSite workspaceId="w" projectId={PID} /></DesignSystemProvider>);
  return fetcher;
};
const triages = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).includes("/issues/"))
  .map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));

describe("client issues on site", () => {
  afterEach(() => { vi.unstubAllGlobals(); nav.search = ""; });

  it("lists the client's issues with what, where, who and the photo, and accepts one as a snag", async () => {
    let current = [issue()];
    const fetcher = mount(() => current);
    await userEvent.click(await screen.findByRole("radio", { name: /Client issues/ }));
    const item = screen.getByRole("listitem", { name: "Issue 3" });
    expect(item).toHaveTextContent("Chipped edge on the kitchen island");
    expect(item).toHaveTextContent("Aisha Al Mansoori");
    expect(item).toHaveTextContent("Kitchen");
    expect(item).toHaveTextContent("To triage");
    expect(within(item).getByRole("img", { name: "chip.jpg" })).toHaveAttribute("src", `/api/client-portal-admin/cases/${CASE}/files/f1?workspaceId=w&preview=1`);
    await userEvent.click(within(item).getByRole("button", { name: "Triage" }));
    const dialog = await screen.findByRole("dialog", { name: "Issue 3" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Severity/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Minor" }));
    current = [issue({ status: "accepted", severity: "minor", snagId: "s9", decidedBy: "Maya Haddad", version: 2 })];
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(triages(fetcher)).toEqual([{ url: `/api/client-portal-admin/projects/${PID}/issues/i1?workspaceId=w`,
      body: { decision: "accept", severity: "minor", note: "", version: 1 } }]));
    const accepted = await screen.findByRole("listitem", { name: "Issue 3" });
    await waitFor(() => expect(accepted).toHaveTextContent("Accepted"));
    expect(within(accepted).getByRole("link", { name: "Open the snag" })).toHaveAttribute("href", `/workspace/projects/${PID}/plan?item=s9`);
  });

  it("declines an issue only with the reason the client reads, from a notice's link", async () => {
    nav.search = "issue=i1";
    const fetcher = mount(() => [issue()]);
    // The link opens the issue, ready to triage.
    const dialog = await screen.findByRole("dialog", { name: "Issue 3" });
    await userEvent.click(within(dialog).getByRole("radio", { name: "Decline" }));
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Why it's declined/ }), "Normal wear from the move");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(triages(fetcher).map((call) => call.body)).toEqual([{ decision: "decline", note: "Normal wear from the move", version: 1 }]));
  });

  it("shows the issues without triage to people who don't manage the project", async () => {
    mount(() => [issue()], false);
    await userEvent.click(await screen.findByRole("radio", { name: /Client issues/ }));
    expect(within(screen.getByRole("listitem", { name: "Issue 3" })).queryByRole("button", { name: "Triage" })).not.toBeInTheDocument();
  });

  it("keeps the site as it was when the client reported nothing", async () => {
    const fetcher = mount(() => []);
    await screen.findByRole("radio", { name: "Daily progress" });
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("/issues"))).toBe(true));
    expect(screen.queryByRole("radio", { name: /Client issues/ })).not.toBeInTheDocument();
  });
});
