import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PettyCashClaim, ProjectPettyCash as State } from "@/lib/petty-cash/types";
import { ProjectPettyCash } from "./project-petty-cash";

const nav = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/projects/p1/petty-cash", useSearchParams: () => new URLSearchParams(nav.query) }));

const claim = (patch: Partial<PettyCashClaim> = {}): PettyCashClaim => ({
  id: "c1", number: 1, reference: "PC-0001", projectId: "p1", projectReference: "PRJ-0007", projectName: "Villa 12", packageId: "k1", packageName: "Kitchen joinery", spentOn: "2026-09-25",
  amount: "45.5000", currency: "AED", description: "Taxi to the tile supplier", category: "transport", receiptName: "taxi.png", noReceiptReason: "", status: "submitted", claimedBy: "u2",
  claimedByName: "Dana Designer", submittedAt: "2026-09-25T10:00:00Z", decidedByName: null, decidedAt: null, decisionNote: "", reimbursedByName: null, reimbursedAt: null,
  reimbursementReference: "", version: 2, ...patch,
});
const state = (patch: Partial<State> = {}): State => ({
  claims: [claim()], packages: [{ id: "k1", name: "Kitchen joinery" }], currency: "AED", today: "2026-09-27", me: "u1", canClaim: true, canApprove: true, ...patch,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST")
  .map(([url, init]) => ({ url: String(url), body: typeof init!.body === "string" ? JSON.parse(init!.body) : "file" }));
const tab = () => render(<DesignSystemProvider><ProjectPettyCash workspaceId="w" projectId="p1" /></DesignSystemProvider>);
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));

describe("petty cash", () => {
  afterEach(() => { vi.unstubAllGlobals(); nav.query = ""; });

  it("claims what was spent, exact to the currency, with its receipt: saved, the receipt attached, then submitted", async () => {
    let current = state({ claims: [], me: "u2", canApprove: false });
    const fetcher = mount((url, body) => {
      if (body?.action === "save") current = { ...current, claims: [claim({ id: String(body.id), status: "draft", receiptName: null, claimedBy: "u2", version: 1 })] };
      else if (url.includes("/receipt")) current = { ...current, claims: [{ ...current.claims[0], receiptName: "taxi.png", version: 2 }] };
      else if (body?.action === "submit") current = { ...current, claims: [{ ...current.claims[0], status: "submitted", version: 3 }] };
      return current;
    });
    tab();
    expect(await screen.findByText("No petty cash yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New claim" }));
    const dialog = await screen.findByRole("dialog", { name: "New claim" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Amount" }), "45.505");
    // The money field keeps the currency's own decimals: a third one is never taken.
    expect(within(dialog).getByRole("textbox", { name: "Amount" })).toHaveValue("45.50");
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Amount" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Amount" }), "45.5");
    await userEvent.type(within(dialog).getByRole("textbox", { name: /What for/ }), "Taxi to the tile supplier");
    await userEvent.click(within(dialog).getByRole("button", { name: /Kind/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Transport" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /Package/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Kitchen joinery" }));
    // Submitted only with a receipt, or why there's none.
    expect(within(dialog).getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeDisabled();
    await userEvent.upload(within(dialog).getByLabelText("Attach receipt"), new File(["png"], "taxi.png", { type: "image/png" }));
    expect(within(dialog).getByText("taxi.png")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /no receipt/ })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(posts(fetcher)).toHaveLength(3));
    const [save, upload, submit] = posts(fetcher);
    expect(save.body).toEqual({ action: "save", id: expect.any(String), spentOn: "2026-09-27", amount: "45.5", description: "Taxi to the tile supplier", category: "transport",
      packageId: "k1", noReceiptReason: "", commandId: expect.any(String) });
    expect(upload).toEqual({ url: expect.stringContaining(`/api/petty-cash/projects/p1/claims/${save.body.id}/receipt`), body: "file" });
    expect(submit.body).toEqual({ action: "submit", claimId: save.body.id, version: 2, commandId: expect.any(String) });
    const sheet = await screen.findByRole("dialog", { name: "PC-0001 · Dana Designer" });
    expect(within(sheet).getByText("Submitted")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("starts a new claim on the kind the person used last", async () => {
    mount(() => state({ me: "u2", canApprove: false, claims: [claim({ id: "c3", number: 3, category: "tools" }), claim(), claim({ id: "c4", number: 4, category: "food", claimedBy: "u9" })] }));
    tab();
    await userEvent.click(await screen.findByRole("button", { name: "New claim" }));
    const dialog = await screen.findByRole("dialog", { name: "New claim" });
    expect(within(dialog).getByRole("button", { name: /Kind/ })).toHaveTextContent("Tools");
  });

  it("lets the project manager approve a claim or reject it with why, never their own; the ones waiting come first", async () => {
    let current = state({ claims: [claim({ id: "c2", number: 2, reference: "PC-0002", description: "Sample tiles", claimedBy: "u1", claimedByName: "Omar Manager" }), claim()] });
    const fetcher = mount((url, body) => {
      if (body?.action === "reject") current = { ...current, claims: current.claims.map((row) => (row.id === body.claimId ? { ...row, status: "rejected" as const, decidedByName: "Omar Manager",
        decisionNote: String(body.note), decidedAt: "2026-09-27T10:00:00Z", version: 3 } : row)) };
      return current;
    });
    tab();
    const table = await grid("Petty cash");
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([expect.stringContaining("PC-0001"), expect.stringContaining("PC-0002")]);
    await userEvent.click(within(table).getByText("Taxi to the tile supplier"));
    let sheet = await screen.findByRole("dialog", { name: "PC-0001 · Dana Designer" });
    expect(within(sheet).getByRole("link", { name: "taxi.png" })).toHaveAttribute("href", expect.stringContaining("/api/petty-cash/claims/c1/receipt"));
    expect(within(sheet).getByRole("button", { name: "Approve" })).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Reject" }));
    const reject = await screen.findByRole("dialog", { name: "Reject PC-0001" });
    expect(within(reject).getByRole("button", { name: "Reject" })).toBeDisabled();
    await userEvent.type(within(reject).getByRole("textbox", { name: /Why it's rejected/ }), "Crew meals come from their allowance");
    await userEvent.click(within(reject).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "reject", claimId: "c1", version: 2, note: "Crew meals come from their allowance", commandId: expect.any(String) }));
    expect(await within(sheet).findByText("Rejected by Omar Manager: Crew meals come from their allowance")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: /Close/ }));
    // My own claim waits for someone else.
    await userEvent.click(within(await grid("Petty cash")).getByText("Sample tiles"));
    sheet = await screen.findByRole("dialog", { name: "PC-0002 · Omar Manager" });
    expect(within(sheet).queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("opens the claim its notice links to, and approves it on its version", async () => {
    nav.query = "claim=c1";
    const fetcher = mount((url, body) => (body ? state({ claims: [claim({ status: "approved", decidedByName: "Omar Manager", decidedAt: "2026-09-27T10:00:00Z", version: 3 })] }) : state()));
    tab();
    const sheet = await screen.findByRole("dialog", { name: "PC-0001 · Dana Designer" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.body).toEqual({ action: "approve", claimId: "c1", version: 2, commandId: expect.any(String) }));
    expect(await within(sheet).findByText("Approved by Omar Manager")).toBeInTheDocument();
  });
});
