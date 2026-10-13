import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CaseContent, CaseDesign, DesignOptions } from "@/lib/pre-project/content";
import { DesignWorkspace } from "./design-workspace";
import { DesignActions } from "./design-actions";
import { nextStep } from "@/lib/pre-project/design-workspace";
import { READ_TIMEOUT_MS } from "@/lib/workspace/read-within";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => "/workspace/pre-projects/cases/c1/designs", useSearchParams: () => new URLSearchParams() }));
afterEach(() => vi.unstubAllGlobals());

const data = { workspaceId: "w", caseId: "c1", canEdit: true, rooms: [{ id: "r1", name: "Kitchen", version: 1 }, { id: "r2", name: "Living room", version: 1 }], entries: [] } as unknown as CaseContent;
const design = (id: string, stage: string | null, roomId: string | null, status: string, extra: Record<string, unknown> = {}) => ({ id, version: 2, title: id, documentType: "Concept / mood board", description: "", roomId, scopeEntryId: null, archivedAt: null, stage, clientRoundsUsed: 0, threads: [], activity: [],
  versions: [{ id: `${id}-v1`, number: 1, note: "", status, reviewerId: null, includedClientRounds: 2, asset: { id: `${id}-a`, name: "a.png", mimeType: "image/png", byteSize: 1, hasPreview: false }, createdAt: "2026-09-20T08:00:00Z", createdByName: "Dana", ...extra }] }) as unknown as CaseDesign;
const options: DesignOptions = { folders: [], reviewers: [{ id: "u2", name: "Omar" }], actorId: "u1", canReview: true, canRecordClient: true };
const stage = (key: string, label: string, status: string, progress: { total: number; approved: number; pending: number } | null = null) => ({ stage: key, label, position: 1, status, version: 3, overdue: false, dueAt: null, completedAt: null, note: null, ownerName: null, progress });
const journey = (stages: unknown[]) => ({ journey: { packageName: "Bespoke", includedRevisions: 2, includesSpacePlanning: true, includesRenders: false }, timezone: "UTC", stages });
const serve = (view: unknown) => { const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => view })); vi.stubGlobal("fetch", fetcher); return fetcher; };
const mount = (designs: CaseDesign[]) => render(<DesignSystemProvider><DesignWorkspace initialData={data} initialDesigns={designs} options={options} /></DesignSystemProvider>);

describe("design workspace", () => {
  it("opens on the current stage and shows its designs with their rooms", async () => {
    serve(journey([stage("concepts", "Concepts", "active", { total: 3, approved: 1, pending: 2 }), stage("space_planning", "Space planning", "locked", { total: 1, approved: 1, pending: 0 }), stage("approval", "Design approval", "locked")]));
    mount([design("Kitchen A", "concepts", "r1", "approved"), design("Kitchen B", "concepts", "r1", "draft"), design("Living", "concepts", "r2", "internal_review"), design("Layout", "space_planning", "r1", "approved"), design("Loose", null, null, "draft")]);
    const tabs = await screen.findByRole("tablist", { name: "Design stages" });
    expect(within(tabs).getByRole("tab", { name: "Concepts" })).toHaveAttribute("aria-selected", "true");
    expect(within(tabs).getByRole("tab", { name: "Other" })).toBeInTheDocument();
    expect(screen.getByText("1 of 3 approved")).toBeInTheDocument();
    // Rooms are folders; opening one shows its files, and "All files" shows every file with its room.
    const rooms = screen.getByRole("list", { name: "Rooms" });
    expect(within(rooms).getByRole("button", { name: /Kitchen.*2 files/ })).toBeInTheDocument();
    fireEvent.click(within(rooms).getByRole("button", { name: /Living room/ }));
    expect(within(screen.getByRole("list", { name: "Designs" })).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(screen.getByRole("navigation", { name: "Folders" })).getByRole("button", { name: "All rooms" }));
    fireEvent.click(screen.getByRole("radio", { name: "All files" }));
    const cards = screen.getByRole("list", { name: "Designs" });
    expect(within(cards).getByRole("button", { name: /Kitchen A.*Kitchen/ })).toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: /Living.*Living room/ })).toBeInTheDocument();
    expect(screen.queryByText("Layout")).not.toBeInTheDocument();
    fireEvent.click(within(tabs).getByRole("tab", { name: "Other" }));
    expect(within(screen.getByRole("list", { name: "Designs" })).getByRole("button", { name: /Loose/ })).toBeInTheDocument();
  });

  it("offers Not needed only for an empty current stage, and asks why", async () => {
    const fetcher = serve(journey([stage("space_planning", "Space planning", "active", { total: 0, approved: 0, pending: 0 }), stage("approval", "Design approval", "locked")]));
    mount([]);
    fireEvent.click(await screen.findByRole("button", { name: "Not needed" }));
    const dialog = await screen.findByRole("dialog");
    const skip = within(dialog).getByRole("button", { name: "Skip stage" });
    expect(skip).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Why/ }), { target: { value: "Open-plan, layout agreed on site" } });
    fireEvent.click(skip);
    await waitFor(() => expect(fetcher.mock.calls.some(([url, init]) => String(url).includes("design-journey/stages/space_planning/skip") && init?.method === "POST")).toBe(true));
  });

  it("shows the sign-off checklist and keeps the button off until everything is done", async () => {
    serve(journey([stage("concepts", "Concepts", "done", { total: 1, approved: 1, pending: 0 }), stage("renders", "3D renders", "active", { total: 1, approved: 0, pending: 1 }), stage("approval", "Design approval", "locked")]));
    mount([design("Kitchen A", "concepts", "r1", "approved"), design("Render", "renders", "r1", "client_review")]);
    fireEvent.click(await screen.findByRole("tab", { name: "Design approval" }));
    expect(screen.getByText("Finish 3D renders")).toBeInTheDocument();
    expect(screen.getByText("1 design waiting for approval")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign off design" })).not.toBeInTheDocument();
  });

  it("says design hasn't started and offers Start to those allowed", async () => {
    serve({ journey: null, stages: [], canStart: true, timezone: "UTC" });
    mount([]);
    expect(await screen.findByText("Design hasn't started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start design" })).toBeInTheDocument();
  });
});

describe("design workspace loading (D9): content, empty, error with Retry, never an endless skeleton", () => {
  it("shows the stages once they load", async () => {
    serve(journey([stage("concepts", "Concepts", "active")]));
    mount([]);
    expect(await screen.findByRole("tab", { name: "Concepts" })).toBeInTheDocument();
  });
  it("shows an error with Retry when the stages fail, and recovers on Retry", async () => {
    const fetcher = vi.fn(async (): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => ({ ok: false, status: 500, json: async () => ({ message: "Design service unavailable" }) }));
    vi.stubGlobal("fetch", fetcher);
    mount([]);
    expect(await screen.findByText("Design didn't load")).toBeInTheDocument();
    fetcher.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ journey: null, stages: [], canStart: true, timezone: "UTC" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Design hasn't started")).toBeInTheDocument();
  });
  it("treats an answer without stages (an empty 200) as a failed load, not as still loading", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } })));
    mount([]);
    expect(await screen.findByText("Design didn't load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
  it("gives up on a read that never answers and offers Retry", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
      mount([]);
      await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
      expect(await screen.findByText("Design didn't load")).toBeInTheDocument();
      expect(screen.getByText("This is taking too long. Try again.")).toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
});

describe("design review actions", () => {
  const mountActions = (item: CaseDesign, opts: Partial<DesignOptions> = {}, canEdit = true) =>
    render(<DesignSystemProvider><DesignActions data={{ ...data, canEdit }} design={item} options={{ ...options, ...opts }} onUpdate={vi.fn()} /></DesignSystemProvider>);
  it.each([
    ["draft", ["Send for review"]],
    ["internal_review", ["Approve", "Send back"]],
    ["internal_approved", ["Present to client"]],
    ["client_review", ["Client approved", "Client wants changes"]],
    ["changes_requested", ["Upload revision"]],
  ])("offers the next steps for %s", (status, labels) => {
    mountActions(design("D", "concepts", "r1", status));
    for (const label of labels) expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
  });
  it("PLM-145: on a package without an internal review, the designer presents the draft to the client and no reviewer is asked for", async () => {
    const fetcher = serve(design("D", "concepts", "r1", "client_review"));
    mountActions(design("D", "concepts", "r1", "draft"), { internalReview: false, reviewers: [] });
    expect(screen.queryByRole("button", { name: "Send for review" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Present to client" }));
    expect(screen.queryByRole("button", { name: /Reviewer/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Present to client" }).at(-1)!);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toMatchObject({ action: "client_review" });
    expect(nextStep(design("E", "concepts", "r1", "draft"), { reviewers: [], internalReview: false })).toEqual({ key: "Present to the client" });
  });
  it("hides steps from people without the right", () => {
    mountActions(design("D", "concepts", "r1", "internal_review", { reviewerId: "u9" }));
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    mountActions(design("E", "concepts", "r1", "client_review"), { canRecordClient: false });
    expect(screen.queryByRole("button", { name: "Client approved" })).not.toBeInTheDocument();
    mountActions(design("F", "concepts", "r1", "draft"), {}, false);
    expect(screen.queryByRole("button", { name: "Send for review" })).not.toBeInTheDocument();
  });
  it("records a client decision with who, how and what, and requires them", async () => {
    const fetcher = serve(design("D", "concepts", "r1", "approved"));
    mountActions(design("D", "concepts", "r1", "client_review"));
    fireEvent.click(screen.getByRole("button", { name: "Client approved" }));
    const record = screen.getByRole("button", { name: "Record decision" });
    expect(record).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /Client/ }), { target: { value: "Maya" } });
    fireEvent.change(screen.getByRole("textbox", { name: /What the client approved/ }), { target: { value: "Approved the island version" } });
    fireEvent.click(record);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ action: "approved", decisionBy: "Maya", decisionSource: "meeting", note: "Approved the island version" });
    expect(Date.parse(body.decisionAt)).toBeLessThanOrEqual(Date.now());
  });
  it("warns that an extra client round is chargeable and asks for the agreement", () => {
    mountActions({ ...design("D", "concepts", "r1", "internal_approved"), clientRoundsUsed: 2 } as CaseDesign);
    fireEvent.click(screen.getByRole("button", { name: "Present to client" }));
    expect(screen.getByText(/included client rounds are used/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Present to client" }).at(-1)).toBeDisabled();
  });
});
