import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { AccountingSettings, Posting } from "@/lib/accounting/types";
import { accountingApi, toOptions } from "@/lib/accounting/client";
import { AccountingPostings } from "../finance/accounting-postings";
import { AccountingSettingsPage } from "./accounting-settings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/settings/accounting", useSearchParams: () => new URLSearchParams() }));

const settings = (patch: Partial<AccountingSettings> = {}): AccountingSettings => ({
  companies: [{ id: "e1", name: "Studio Furniture", currency: "AED", link: null, rates: ["0", "5"] }],
  connections: [{ id: "c1", provider: "quickbooks", name: "Studio QuickBooks", legalEntityId: null, status: "connected" }], ...patch,
});
const quickbooks: Record<string, Array<Record<string, unknown>>> = {
  items: [{ Id: "1", Name: "Fit-out services", Type: "Service", Active: true }, { Id: "2", Name: "Old item", Active: false }],
  accounts: [{ Id: "7", Name: "Materials", AccountType: "Cost of Goods Sold", Active: true }, { Id: "35", Name: "Emirates NBD", AccountType: "Bank", Active: true },
    { Id: "80", Name: "Sales", AccountType: "Income", Active: true }],
  taxes: [{ Id: "TAX5", Name: "SR", Active: true }, { Id: "TAX0", Name: "ZR", Active: true }],
};
const mount = (respond: (url: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200, json: async () => respond(url, typeof init?.body === "string" ? JSON.parse(init.body) : undefined) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

describe("accounting", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the accounting system's items, accounts and tax codes whichever names it uses", () => {
    expect(toOptions([{ Id: "7", Name: "Materials", AccountType: "Cost of Goods Sold" }, { account_id: "9", account_name: "Bank", account_type: "bank" },
      { tax_id: "t1", tax_name: "VAT", tax_percentage: 5 }, { nothing: true }])).toEqual([
      { id: "7", name: "Materials", type: "cost of goods sold", rate: null }, { id: "9", name: "Bank", type: "bank", rate: null }, { id: "t1", name: "VAT", type: "", rate: "5" }]);
  });

  it("sets where a company posts from the connection's own lists, with a tax code per rate", async () => {
    const fetcher = mount((url, body) => {
      if (url.includes("/tools?")) return { items: quickbooks[new URL(url, "http://x").searchParams.get("kind")!], hasMore: false };
      if (body) return settings({ companies: [{ ...settings().companies[0], link: { id: "l1", legalEntityId: "e1", connectionId: "c1", startDate: "2026-01-01", salesItemId: "1",
        expenseAccountId: "7", paymentsAccountId: "35", depositAccountId: null, pettyCashAccountId: "7", pettyCashPaidFromId: "35", active: true, version: 1,
        taxCodes: [{ rate: "5.0000", providerTaxId: "TAX5" }], counts: {} } }] });
      return settings();
    });
    render(<DesignSystemProvider><AccountingSettingsPage workspaceId="w" /></DesignSystemProvider>);
    const section = await screen.findByRole("region", { name: "Studio Furniture" }).catch(() => screen.findByText("Studio Furniture").then((node) => node.closest("section")!));
    await userEvent.click(await within(section).findByRole("button", { name: /Item for invoice lines/ }));
    expect(screen.queryByRole("option", { name: "Old item" })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: "Fit-out services" }));
    // Bills offer expense accounts, payments offer bank accounts.
    await userEvent.click(within(section).getByRole("button", { name: /Expense account for bills/ }));
    expect(screen.queryByRole("option", { name: "Emirates NBD" })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: "Materials" }));
    await userEvent.click(within(section).getByRole("button", { name: /Supplier payments from/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Emirates NBD" }));
    // Petty cash goes to an expense account, paid from a bank or cash account.
    await userEvent.click(within(section).getByRole("button", { name: /Expense account for petty cash/ }));
    expect(screen.queryByRole("option", { name: "Emirates NBD" })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: "Materials" }));
    await userEvent.click(within(section).getByRole("button", { name: /Petty cash paid from/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Emirates NBD" }));
    await userEvent.click(within(section).getByRole("button", { name: /Tax at 5%/ }));
    await userEvent.click(await screen.findByRole("option", { name: "SR" }));
    const [month, day, year] = within(within(section).getByRole("group", { name: /Post from/ })).getAllByRole("spinbutton");
    await userEvent.type(month, "1"); await userEvent.type(day, "1"); await userEvent.type(year, "2026");
    await userEvent.click(within(section).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fetcher.mock.calls.at(-1)![1]).toMatchObject({ method: "PUT" }));
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)![1]!.body))).toMatchObject({ legalEntityId: "e1", connectionId: "c1", salesItemId: "1", expenseAccountId: "7",
      paymentsAccountId: "35", depositAccountId: null, pettyCashAccountId: "7", pettyCashPaidFromId: "35", version: 0, taxCodes: [{ rate: "5", providerTaxId: "TAX5" }] });
  });

  it("lists the postings that need attention and retries one", async () => {
    const posting = (patch: Partial<Posting>): Posting => ({ id: "p1", kind: "bill", status: "blocked", documentDate: "2026-09-26", label: "Nile Marble · NM-77", companyName: "Studio Furniture",
      provider: "quickbooks", attempts: 0, providerNumber: null, errorCode: "mapping_required", error: "Choose the expense account for supplier bills in Settings → Accounting.", sentAt: null,
      nextAt: null, ...patch });
    const list = [posting({}), posting({ id: "p2", kind: "invoice", status: "sent", label: "FAC-INV-2026-00001 · Maya Client", providerNumber: "1045", errorCode: null, error: null })];
    const fetcher = mount((url, body) => (body !== undefined ? { postings: [{ ...list[0], status: "pending", error: null, errorCode: null }, list[1]] } : { postings: list }));
    render(<DesignSystemProvider><AccountingPostings api={accountingApi("w")} /></DesignSystemProvider>);
    const table = await screen.findByRole("grid", { name: "Accounting postings" }).catch(() => screen.findByRole("table", { name: "Accounting postings" }));
    expect(table).toHaveTextContent("Nile Marble · NM-77");
    expect(table).toHaveTextContent("Needs a mapping");
    expect(table).not.toHaveTextContent("FAC-INV-2026-00001");
    await userEvent.click(within(table).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(String(fetcher.mock.calls.at(-1)![0])).toContain("/api/accounting/postings/p1/retry"));
  });
});
