import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { JobRow, JourneyView } from "@/lib/jobs/journey";
import { QuickPanel } from "./quick-panel";
import { rememberJob } from "./recent-jobs";

const workspaceId = "2ab00a25-4912-469a-9081-d8602f2b715a";
const job = (patch: Partial<JobRow>): JobRow => ({ id: "11111111-1111-4111-8111-111111111111", reference: "J-000001", title: "Villa 12", client: "Dana", chapter: "make",
  now: { label: "Factory", owner: null, dueAt: null, late: false }, progress: { done: 20, total: 29 }, value: null, targetDate: null, ...patch });
const villa = job({ now: { label: "Factory", owner: null, dueAt: "2026-10-01", late: true } });
const penthouse = job({ id: "22222222-2222-4222-8222-222222222222", reference: "J-000002", title: "Penthouse", client: "Layla", chapter: "design", now: { label: "Inspiration", owner: null, dueAt: null, late: false } });
const journey = { jobId: penthouse.id, reference: "J-000002", title: "Penthouse", client: "Layla", chapters: [], lanes: [], steps: [], next: [], value: null, targetDate: null,
  now: { key: "design:inspiration", chapter: "design", lane: "client", label: "Inspiration", state: "now", doneAt: null, doneBy: null, dueAt: null, href: null, owner: "Client", doneWhen: "x" } } as unknown as JourneyView;

function serve() {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes("/overview") ? { items: [villa, penthouse], total: 2 } : url.includes("/journey") ? journey
      : url.includes("/money") ? { currency: "AED", agreed: "0", received: "0", due: "0", credit: "0", overdue: "0", unallocated: "0", next: null, lines: [], milestones: [], checks: [] }
      : url.includes("/documents") ? { sends: [], signatures: [] } : null;
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

describe("the quick panel (§0.3)", () => {
  it("opens with ⌘J, shows late and recent jobs, finds by word and looks at a job without leaving the page", async () => {
    serve();
    rememberJob(penthouse.id);
    render(<DesignSystemProvider><QuickPanel workspaceId={workspaceId} /></DesignSystemProvider>);
    await userEvent.keyboard("{Meta>}j{/Meta}");
    const dialog = await screen.findByRole("dialog", { name: "Quick look" });
    expect(await screen.findByRole("region", { name: "Late" })).toHaveTextContent("Villa 12");
    expect(screen.getByRole("region", { name: "Recent" })).toHaveTextContent("Penthouse");
    await userEvent.type(screen.getByRole("textbox", { name: "Find a job" }), "layla");
    expect(screen.getByRole("region", { name: "Results" })).toHaveTextContent("Penthouse");
    expect(screen.getByRole("region", { name: "Results" })).not.toHaveTextContent("Villa 12");
    await userEvent.click(screen.getByRole("button", { name: /Penthouse/ }));
    expect(await screen.findByText("Inspiration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open job" })).toHaveAttribute("href", `/workspace/jobs/${penthouse.id}`);
    expect(screen.getByRole("tab", { name: "Money" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Find a job" })).toBeInTheDocument());
    expect(dialog).toBeInTheDocument();
  });

  it("says when the jobs can't load and retries", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DesignSystemProvider><QuickPanel workspaceId={workspaceId} /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Quick look" }));
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
