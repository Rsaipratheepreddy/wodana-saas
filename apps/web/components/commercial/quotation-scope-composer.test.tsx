import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotationScopeComposer } from "./quotation-scope-composer";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/commercial/client", async () => ({ ...await vi.importActual("@/lib/commercial/client"), jsonRequest: request }));

const run = {
  id: "run-id", status: "proposed", stale: false, staleReasons: [], duplicates: ["duplicate-id"],
  proposal: { coverage: { unlinkedSourceIds: [] }, notes: [], items: [
    { id: "new-id", roomName: "Bedroom", line: { title: "Wardrobe", quantity: 1, unit: "nos", rate: 0 }, status: "price_required", issue: "Add a selling price" },
    { id: "duplicate-id", roomName: "Bedroom", line: { title: "Existing item", quantity: 1, unit: "nos", rate: 200 }, status: "ready" },
  ] },
};
const composer = {
  revision: 3,
  definition: { id: "baseline", number: 2, confirmed: true, current: true },
  readiness: { readyForReview: false, blockers: [], warnings: [{ code: "UNCOVERED_SCOPE", message: "One item is not included." }] },
  coverage: {
    included: [{ id: "scope-1", title: "Wardrobe", roomName: "Bedroom" }],
    covered: [],
    uncovered: [{ id: "scope-1", title: "Wardrobe", roomName: "Bedroom" }],
  },
  comparison: {
    previousQuoteId: "previous",
    added: 1,
    removed: 0,
    changed: 1,
    totalDelta: 100,
    details: {
      added: [{ id: "new", room: "Bedroom", title: "Wardrobe", optional: false }],
      removed: [],
      changed: [{ id: "changed", room: "Living", title: "Media wall", optional: false, changes: ["quantity"] }],
    },
  },
  runs: [],
};
afterEach(() => request.mockReset());

describe("quotation scope composer", () => {
  it("requires a client-confirmed scope and links to the correct case", async () => {
    request.mockResolvedValue({ ...composer, definition: null });
    render(<QuotationScopeComposer workspaceId="workspace" caseId="case" quoteId="quote" revision={3} lineCount={0} dirty={false} onApplied={vi.fn()} />);
    expect(await screen.findByRole("link", { name: "Confirm scope" })).toHaveAttribute("href", "/workspace/pre-projects/cases/case/definition");
    expect(screen.getByText("Requirements → quotation → project")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Add .* missing/ })).not.toBeInTheDocument();
  });

  it("keeps legacy quotations open when the core omits composer diagnostics", async () => {
    const { coverage: _coverage, readiness: _readiness, comparison: _comparison, ...legacy } = composer;
    request.mockResolvedValue(legacy);
    render(<QuotationScopeComposer workspaceId="workspace" caseId="case" quoteId="quote" revision={3} lineCount={3} dirty={false} onApplied={vi.fn()} />);
    expect(await screen.findByText("Scope covered")).toBeVisible();
    expect(screen.queryByText("Review scope connection")).not.toBeInTheDocument();
  });

  it("uses the backend proposal and applies only selected non-duplicate items", async () => {
    request.mockImplementation(async (url: string, method?: string) => {
      if (url.includes("/quotation-composer")) return composer;
      if (url.includes("/quotation-proposals?") && method === "POST") return { run };
      if (url.includes("/apply?") && method === "POST") return { addedItemIds: ["new-id"], skippedDuplicateItemIds: [] };
      throw new Error(`Unexpected request: ${url}`);
    });
    const applied = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<QuotationScopeComposer workspaceId="workspace" caseId="case" quoteId="quote" revision={3} lineCount={0} dirty={false} onApplied={applied} />);
    await user.click(await screen.findByRole("button", { name: "Add 1 missing item" }));
    await waitFor(() => expect(applied).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith(expect.stringContaining("/quotation-proposals/run-id/apply"), "POST", expect.objectContaining({ revision: 3, selectedItemIds: ["new-id"] }));
    expect(await screen.findByText(/1 confirmed scope item added/)).toBeVisible();
  });

  it("requires saving local quotation edits before creating a proposal", async () => {
    request.mockResolvedValue(composer);
    render(<QuotationScopeComposer workspaceId="workspace" caseId="case" quoteId="quote" revision={3} lineCount={0} dirty onApplied={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Add 1 missing item" })).toBeDisabled();
    expect(screen.getByText(/Save the current sheet edits/)).toBeVisible();
  });
});
