import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ProjectMoney as Money } from "@/lib/project-core/types";
import { ProjectMoney } from "./project-money";

const state = (patch: Partial<Money> = {}): Money => ({
  currency: "AED", income: { currency: "AED", agreed: "7850.0000", agreedNet: "7850.0000", requested: "7850.0000", invoiced: "3925.0000", received: "3925.0000" },
  spent: "1428.0000", committed: "860.0000", forecast: "2288.0000", budget: "1500.0000", margin: "5562.0000", available: "1637.0000",
  packages: [
    { id: "k1", name: "Lights", budget: "500.0000", budgetVersion: 1, budgetNote: "", spent: "520.0000", committed: "0.0000", forecast: "520.0000", over: true },
    { id: "k2", name: "Fitting", budget: "1000.0000", budgetVersion: 1, budgetNote: "", spent: "400.0000", committed: "500.0000", forecast: "900.0000", over: false },
    { id: null, name: null, budget: null, budgetVersion: 0, budgetNote: "", spent: "508.0000", committed: "360.0000", forecast: "868.0000", over: false },
  ],
  entries: [
    { key: "stock:1", on: "2026-09-25", source: "stock", description: "Received: Oak veneer 6 sheets", reference: "FAC-PO-2026-00001", packageId: null, packageName: null, amount: "540.0000" },
    { key: "bill:1", on: "2026-09-26", source: "price_difference", description: "Under-cabinet lights: invoiced at a different price", reference: "Nile Marble INV-L", packageId: "k1",
      packageName: "Lights", amount: "20.0000" },
  ],
  uncosted: 1, canManage: true, ...patch,
});
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const grid = (name: string) => screen.findByRole("grid", { name }).catch(() => screen.findByRole("table", { name }));

describe("project money", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows what came in and went out, the margin, and each package against its budget", async () => {
    mount(() => state());
    render(<DesignSystemProvider><ProjectMoney workspaceId="w" projectId="p1" /></DesignSystemProvider>);
    const table = await grid("Budget by package");
    expect(screen.getByText("Received").closest("div")).toHaveTextContent(/3,925/);
    expect(screen.getByText("Margin").closest("div")).toHaveTextContent(/5,562.*70\.9% of/);
    expect(screen.getByText("Cash in hand").closest("div")).toHaveTextContent(/1,637/);
    expect(screen.getByText(/1 costs have no price or exchange rate/)).toBeInTheDocument();
    expect(table).toHaveTextContent(/Lights.*520.*20.00 over/);
    expect(table).toHaveTextContent(/Fitting.*100/);
    expect(table).toHaveTextContent("Not in a package");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Show" })).getByRole("radio", { name: "Every cost" }));
    const costs = await grid("Every cost");
    expect(costs).toHaveTextContent("Received: Oak veneer 6 sheets");
    expect(costs).toHaveTextContent("Invoice price");
  });

  it("sets a package's budget, version-checked", async () => {
    const fetcher = mount((url, body) => (body ? state({ packages: state().packages.map((row) => (row.id === null ? { ...row, budget: "900.0000", budgetVersion: 1 } : row)) }) : state()));
    render(<DesignSystemProvider><ProjectMoney workspaceId="w" projectId="p1" /></DesignSystemProvider>);
    const table = await grid("Budget by package");
    await userEvent.click(within(table).getByRole("button", { name: "Set budget" }));
    const dialog = await screen.findByRole("dialog", { name: "Budget for Not in a package" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Budget" }), "900");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.at(-1)![1]).toMatchObject({ method: "PUT" }));
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toEqual({ packageId: null, amount: "900", note: "", version: 0 });
    expect(String(fetcher.mock.calls.at(-1)![0])).toContain("/api/project-core/projects/p1/money/budgets");
  });

  it("shows budgets read-only and no margin when the project is in another currency", async () => {
    mount(() => state({ canManage: false, margin: null, available: null, income: { ...state().income, currency: "USD" } }));
    render(<DesignSystemProvider><ProjectMoney workspaceId="w" projectId="p1" /></DesignSystemProvider>);
    const table = await grid("Budget by package");
    expect(within(table).queryByRole("button", { name: "Set budget" })).toBeNull();
    expect(screen.getByText(/The project is in USD and costs are in AED/)).toBeInTheDocument();
    expect(screen.queryByText("Margin")).toBeNull();
  });
});
