import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HrmsCrewState, SiteAccess } from "@wodana/contracts";
import { DesignSystemProvider } from "@/design-system";
import { WorkspaceIdentityProvider } from "@/components/workspace/workspace-identity";
import type { SiteState } from "@/lib/site/types";
import { ProjectSite } from "../site/project-site";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/projects/p1/site", useSearchParams: () => new URLSearchParams(""),
}));

const PID = "0c6b0c7e-4c4d-4a9e-9d64-3b6f0f2d7a11";
const site = (patch: Partial<SiteState> = {}): SiteState => ({ site: { startedOn: "2026-09-21", finishedOn: null }, reports: [], lines: [],
  members: [{ membershipId: "m5", name: "Leila Electrician" }, { membershipId: "m6", name: "Sam Surveyor" }], today: "2026-09-27", me: "u1", canReport: true, canApprove: true, canManage: true, ...patch });
const access = (patch: Partial<SiteAccess> = {}): SiteAccess => ({
  projectId: PID, day: "2026-09-27", required: ["work_permit", "safety_induction"],
  entries: [{ id: "e1", crewId: "c1", workerId: null, membershipId: null, name: "Joinery A" }, { id: "e2", crewId: null, workerId: null, membershipId: "m5", name: "Leila Electrician" }],
  people: [
    { subject: { kind: "worker", id: "w1" }, name: "Ravi Kumar", detail: "Carpentry · Joinery A", cleared: true, missing: [], expired: [],
      documents: [{ kind: "work_permit", title: "Work permit", number: "784-1990-123", expiresOn: "2027-01-31" }, { kind: "safety_induction", title: "Induction", number: "IND-9", expiresOn: null }] },
    { subject: { kind: "worker", id: "w2" }, name: "Anil Das", detail: "Carpentry · Joinery A", cleared: false, missing: ["work_permit"], expired: ["safety_induction"], documents: [] },
    { subject: { kind: "member", id: "m5" }, name: "Leila Electrician", detail: "Electrician", cleared: true, missing: [], expired: [],
      documents: [{ kind: "work_permit", title: "Work permit", number: "784-1985-777", expiresOn: "2026-12-01" }] },
  ],
  canManage: true, ...patch,
});
const crews: HrmsCrewState = {
  crews: [{ id: "c1", name: "Joinery A", trade: "Carpentry", vendorId: null, vendorName: null, leadMembershipId: null, leadName: null, active: true, version: 1, workers: 2 },
    { id: "c2", name: "Painters", trade: "Painting", vendorId: null, vendorName: null, leadMembershipId: null, leadName: null, active: true, version: 1, workers: 1 }],
  workers: [], canManage: false,
};

type Call = { path: string; method: string; body: unknown; query: URLSearchParams };
const mount = (routes: (call: Call) => unknown, state = site()) => {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, "http://localhost");
    const path = parsed.pathname.replace(/^\/api\/workspace\/hrms\/?/, "");
    const call = { path, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined, query: parsed.searchParams };
    calls.push(call);
    let value = routes(call);
    if (value === undefined) value = path.startsWith("/api/site/") ? state : path === "site-access" ? access() : path === "crews" ? crews : { id: "ok" };
    if (value instanceof Error) return { ok: false, status: 403, json: async () => ({ message: value.message }) };
    return { ok: true, status: 200, json: async () => value };
  }));
  return calls;
};
const show = () => render(<DesignSystemProvider locale="en-GB" timeZone="UTC">
  <WorkspaceIdentityProvider identity={{ name: "Palm Living", logoUrl: "/api/workspace/logo?variant=square" }}>
    <ProjectSite workspaceId="w" projectId={PID} projectName="PRJ-7 · Villa 12" />
  </WorkspaceIdentityProvider>
</DesignSystemProvider>);
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));
const openAccess = async () => { await userEvent.click(await screen.findByRole("radio", { name: "Access" })); return grid("Site access"); };

describe("site access", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-27T10:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("shows who may go on site, the ones who can't yet first, with what's missing or expired", async () => {
    const calls = mount(() => undefined);
    show();
    const table = await openAccess();
    const rows = within(table).getAllByRole("row");
    expect(rows[0]).toHaveTextContent(/Name.*Status.*Documents/);
    expect(rows[1]).toHaveTextContent(/Anil Das.*Carpentry · Joinery A.*Missing Work permit.*Expired Safety induction/);
    expect(rows[2]).toHaveTextContent(/Leila Electrician.*Cleared.*Work permit 784-1985-777 until 1 Dec/);
    expect(rows[3]).toHaveTextContent(/Ravi Kumar.*Cleared/);
    expect(calls.find((call) => call.path === "site-access")!.query.get("projectId")).toBe(PID);
  });

  it("lets the project's managers add a crew, a worker or a person to the list, and take one off", async () => {
    const calls = mount(({ path, method }) => (method === "POST" && path.startsWith("site-access") ? access() : undefined));
    show();
    await openAccess();
    await userEvent.click(screen.getByRole("button", { name: "Edit list" }));
    const dialog = await screen.findByRole("dialog", { name: "Site list" });
    expect(within(dialog).getByRole("list", { name: "On the list" })).toHaveTextContent(/Joinery A.*Crew.*Leila Electrician.*Staff/);
    // Already on the list: not offered again.
    await userEvent.click(await within(dialog).findByRole("button", { name: /Crew$/ }));
    expect(screen.queryByRole("option", { name: /^Joinery A/ })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: /^Painters/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST" && call.path === "site-access").map((call) => call.body))
      .toEqual([{ projectId: PID, crewId: "c2", workerId: null, membershipId: null }]));
    await userEvent.click(within(dialog).getByRole("radio", { name: "Staff" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Staff$/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Sam Surveyor" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "POST" && call.path === "site-access").at(-1)!.body).toEqual({ projectId: PID, crewId: null, workerId: null, membershipId: "m6" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove Joinery A" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path === "site-access/e1/remove")).toBe(true));
  });

  it("shows site supervisors the list without changing it", async () => {
    mount(({ path }) => (path === "site-access" ? access({ canManage: false }) : undefined));
    show();
    await openAccess();
    expect(screen.queryByRole("button", { name: "Edit list" })).toBeNull();
    expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
  });

  it("prints the cleared people with their documents' numbers under the workspace's name and logo, the project and the day", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    mount(() => undefined);
    show();
    await openAccess();
    await userEvent.click(screen.getByRole("button", { name: "Print" }));
    await waitFor(() => expect(document.querySelector('section[aria-label="Gate list"]')).not.toBeNull());
    const sheet = document.querySelector<HTMLElement>('section[aria-label="Gate list"]')!;
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(sheet.parentElement).toBe(document.body);
    expect(within(sheet).getByRole("img", { name: "Palm Living", hidden: true })).toHaveAttribute("src", "/api/workspace/logo?variant=square");
    expect(within(sheet).getByRole("heading", { name: "PRJ-7 · Villa 12", hidden: true })).toBeInTheDocument();
    expect(within(sheet).getByText("Cleared for site on Sunday, 27 September 2026")).toBeInTheDocument();
    const rows = within(sheet).getAllByRole("row", { hidden: true });
    expect(rows.map((row) => row.textContent)).toEqual([
      "NameRoleDocuments",
      expect.stringMatching(/^Leila ElectricianElectricianWork permit 784-1985-777 until 1 Dec/),
      expect.stringMatching(/^Ravi KumarCarpentry · Joinery AWork permit 784-1990-123 until 31 Jan 2027 · Safety induction IND-9$/),
    ]);
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() => expect(document.querySelector('section[aria-label="Gate list"]')).toBeNull());
  });
});
