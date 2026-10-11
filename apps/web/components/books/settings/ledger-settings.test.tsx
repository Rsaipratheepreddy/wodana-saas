import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { AccountView, CompanySummary, LedgerSettingsView } from "@/lib/books/settings-client";
import { LedgerSettings } from "./ledger-settings";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/workspace/settings/ledger", useSearchParams: () => new URLSearchParams() }));

const COMPANY = "00000000-0000-4000-8000-0000000000e1";
const templates = [{ code: "AE", version: 1, name: "United Arab Emirates (VAT)", recommended: true }, { code: "IFRS", version: 1, name: "IFRS (no tax)", recommended: false }];
const off: CompanySummary = { id: COMPANY, code: "MAIN", name: "Studio Interiors LLC", countryCode: "AE", baseCurrency: "AED", settings: null, templates };
const settings = {
  workspaceId: "w", legalEntityId: COMPANY, enabled: true, startDate: "2026-10-01", lockDate: null, functionalCurrency: "AED", fiscalYearStartMonth: 1,
  templateCode: "AE", templateVersion: 1, revenueRecognition: "invoice" as const, taxPointOnPayment: true, vatRegion: "DXB", version: 3,
};
const account = (code: string, name: string, patch: Partial<AccountView> = {}): AccountView => ({
  id: `acc-${code}`, code, name, type: "asset", subtype: "", parentId: null, isControl: false, allowManual: true, currency: null, archived: false, used: false, roles: [],
  templateKey: null, version: 1, ...patch,
});
const view = (): LedgerSettingsView => ({
  company: { ...off, settings },
  regions: { label: "Emirate", options: [{ code: "DXB", name: "Dubai" }, { code: "AUH", name: "Abu Dhabi" }] },
  accounts: [account("1100", "Bank"), account("1200", "Trade receivables", { isControl: true, allowManual: false, roles: ["ar_control"], used: true }),
    account("6100", "General expenses", { type: "expense", roles: ["general_expense"] })],
  roles: [{ role: "ar_control", accountId: "acc-1200", version: 1 }, { role: "general_expense", accountId: "acc-6100", version: 1 }],
  paymentAccounts: [{ direction: "in", method: "bank", accountId: "acc-1100", version: 1 }, { direction: "out", method: "cash", accountId: null, version: 0 }],
  taxCodes: [{ id: "tax-sr", code: "SR", name: "Standard rated", rate: "5", treatment: "standard", direction: "sales", recoverable: false, baseBox: "1", taxBox: "1",
    rcOutputBox: null, effectiveFrom: "2018-01-01", effectiveTo: null, archived: false, used: false, version: 1 }],
  hasJournals: false, today: "2026-10-08", canManage: true,
});

const capabilities = { accrual: true, cash: true, drillDown: true, cashAccounts: true, forecast: true };
const none = { accrual: false, cash: false, drillDown: false, cashAccounts: false, forecast: false };
const sourceView = { legalEntityId: COMPANY, source: "operational_cash", chosen: false, version: 0, canManage: true,
  company: { id: COMPANY, code: "MAIN", name: "Studio Interiors LLC", currency: "AED", locale: "en-AE", timeZone: "Asia/Dubai", countryCode: "AE", today: "2026-10-08", fiscalYearStartMonth: 1, ledgerOn: false },
  companies: [], options: [{ source: "ledger", available: false, label: null, capabilities: none }, { source: "zoho_books", available: false, label: null, capabilities: none },
    { source: "quickbooks", available: false, label: null, capabilities: none }, { source: "operational_cash", available: true, label: null, capabilities }] };
const mount = (given: (url: string, method: string, body: Record<string, unknown> | undefined) => unknown) => {
  const respond = (url: string, method: string, body: Record<string, unknown> | undefined) => (url.includes("/api/books/statements/") && method === "GET" ? sourceView : given(url, method, body));
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200,
    json: async () => respond(url, init?.method ?? "GET", typeof init?.body === "string" ? JSON.parse(init.body) : undefined) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posted = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));

describe("Settings › Ledger", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offers Turn on Ledger with the company's country template chosen, and turns it on from the start date", async () => {
    let on = false;
    const fetcher = mount((url, method, body) => {
      if (method === "POST" && body?.action === "turn_on") { on = true; return view(); }
      if (url.includes(`/settings/${COMPANY}`)) return view();
      return { companies: [on ? { ...off, settings } : off], canManage: true };
    });
    render(<DesignSystemProvider><LedgerSettings workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByText("Studio Interiors LLC")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Chart of accounts/ }).textContent).toContain("United Arab Emirates (VAT)");
    const turnOn = screen.getByRole("button", { name: "Turn on Ledger" });
    expect(turnOn.hasAttribute("disabled") || turnOn.getAttribute("aria-disabled") === "true" || turnOn.hasAttribute("data-disabled")).toBe(true);
    const start = screen.getByRole("group", { name: "Start date" });
    await userEvent.click(within(start).getAllByRole("spinbutton")[0]);
    await userEvent.keyboard("10012026");
    await userEvent.click(screen.getByRole("button", { name: "Turn on Ledger" }));
    await waitFor(() => expect(posted(fetcher)).toEqual([expect.objectContaining({ action: "turn_on", legalEntityId: COMPANY, templateCode: "AE", startDate: "2026-10-01",
      commandId: expect.stringMatching(/^[0-9a-f-]{36}$/) })]));
    expect(await screen.findByRole("tab", { name: "General" })).toBeTruthy();
  });

  // The region field, not the chart template (whose name, "United Arab Emirates", holds the same word).
  const regionField = (name: string) => name.includes("Emirate") && !name.includes("Chart of accounts");

  it("asks for the region the tax return splits by when turning on, suggested from the company's address, and sends it", async () => {
    const regions = { label: "Emirate", options: [{ code: "AUH", name: "Abu Dhabi" }, { code: "DXB", name: "Dubai" }] };
    const fetcher = mount((url, method, body) => {
      if (method === "POST" && body?.action === "turn_on") return view();
      if (url.includes(`/settings/${COMPANY}`)) return view();
      return { companies: [{ ...off, turnOnRegions: { AE: { ...regions, suggested: null } } }], canManage: true };
    });
    render(<DesignSystemProvider><LedgerSettings workspaceId="w" /></DesignSystemProvider>);
    expect(await screen.findByText("Studio Interiors LLC")).toBeTruthy();
    const start = screen.getByRole("group", { name: "Start date" });
    await userEvent.click(within(start).getAllByRole("spinbutton")[0]);
    await userEvent.keyboard("10012026");
    // No region from the address: Turn on waits for it.
    const turnOn = () => screen.getByRole("button", { name: "Turn on Ledger" });
    expect(turnOn().hasAttribute("disabled") || turnOn().getAttribute("aria-disabled") === "true" || turnOn().hasAttribute("data-disabled")).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: regionField }));
    await userEvent.click(await screen.findByRole("option", { name: "Dubai" }));
    await userEvent.click(turnOn());
    await waitFor(() => expect(posted(fetcher)).toEqual([expect.objectContaining({ action: "turn_on", templateCode: "AE", startDate: "2026-10-01", vatRegion: "DXB" })]));
  });

  it("suggests the region from the company's address", async () => {
    mount((url) => url.includes(`/settings/${COMPANY}`) ? view()
      : { companies: [{ ...off, turnOnRegions: { AE: { label: "Emirate", options: [{ code: "AUH", name: "Abu Dhabi" }, { code: "DXB", name: "Dubai" }], suggested: "DXB" } } }], canManage: true });
    render(<DesignSystemProvider><LedgerSettings workspaceId="w" /></DesignSystemProvider>);
    expect((await screen.findByRole("button", { name: regionField })).textContent).toContain("Dubai");
  });

  it("shows the company's settings in tabs: General, Accounts, Tax codes, Payment accounts", async () => {
    const fetcher = mount((url, method, body) => {
      if (method === "POST") {
        const next = view();
        if (body?.action === "map_payment_account") next.paymentAccounts[1] = { direction: "out", method: "cash", accountId: String(body.accountId), version: 1 };
        return next;
      }
      if (url.includes(`/settings/${COMPANY}`)) return view();
      return { companies: [{ ...off, settings }], canManage: true };
    });
    render(<DesignSystemProvider><LedgerSettings workspaceId="w" /></DesignSystemProvider>);
    expect((await screen.findAllByRole("tab")).map((tab) => tab.textContent)).toEqual(["General", "Accounts", "Tax codes", "Payment accounts", "Statements"]);
    expect(screen.getByRole("button", { name: /Emirate/ }).textContent).toContain("Dubai");
    expect(screen.getByRole("switch", { name: "Ledger on" })).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    const accounts = await screen.findByRole("grid", { name: "Accounts" }).catch(() => screen.findByRole("table", { name: "Accounts" }));
    expect(within(accounts).getAllByText("Trade receivables").length).toBeGreaterThan(0);
    expect(within(accounts).getAllByText("Control account")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add account" })).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "Tax codes" }));
    expect((await screen.findAllByText("Standard rated")).length).toBeGreaterThan(0);
    expect(screen.getByText("5%")).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "Payment accounts" }));
    await userEvent.click(await screen.findByRole("button", { name: /Money out · Cash/ }));
    await userEvent.click(await screen.findByRole("option", { name: "1100 · Bank" }));
    await waitFor(() => expect(posted(fetcher)).toEqual([expect.objectContaining({ action: "map_payment_account", direction: "out", method: "cash", accountId: "acc-1100", version: 0 })]));
  });

  it("asks before moving the lock date and sends the confirmation with the version", async () => {
    const fetcher = mount((url, method) => {
      if (method === "POST") return { ...view(), company: { ...view().company, settings: { ...settings, lockDate: "2026-09-30", version: 4 } } };
      if (url.includes(`/settings/${COMPANY}`)) return view();
      return { companies: [{ ...off, settings }], canManage: true };
    });
    render(<DesignSystemProvider><LedgerSettings workspaceId="w" /></DesignSystemProvider>);
    const lock = await screen.findByRole("group", { name: "Lock date" });
    await userEvent.click(within(lock).getAllByRole("spinbutton")[0]);
    await userEvent.keyboard("09302026");
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Lock the books up to 2026-09-30?" });
    expect(posted(fetcher)).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Lock" }));
    await waitFor(() => expect(posted(fetcher)).toEqual([expect.objectContaining({ action: "update_settings", version: 3, lockDate: "2026-09-30", confirmLockDate: true })]));
  });

  it("chooses where the statements come from, offering only sources that can serve the company", async () => {
    const on = { ...sourceView, source: "ledger", options: sourceView.options.map((option) => option.source === "ledger" ? { ...option, available: true, capabilities } : option) };
    const fetcher = mount((url, method, body) => {
      if (method === "POST" && url.includes("/api/books/statements/source")) return { ...on, source: body?.source, chosen: true, version: 1 };
      if (url.includes(`/settings/${COMPANY}`)) return view();
      return { companies: [{ ...off, settings }], canManage: true };
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => url.includes("/api/books/statements/") && (init?.method ?? "GET") === "GET"
      ? { ok: true, status: 200, json: async () => on } : fetcher(url, init)));
    render(<DesignSystemProvider><LedgerSettings workspaceId="w" /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("tab", { name: "Statements" }));
    const choices = await screen.findByRole("radiogroup", { name: "Where the books live" });
    expect(within(choices).getByRole("radio", { name: /Zoho Books/ })).toBeDisabled();
    expect(within(choices).getByRole("radio", { name: /Wodana Ledger/ })).toBeChecked();
    expect(screen.getByRole("link", { name: "Connect an accounting system" })).toHaveAttribute("href", "/workspace/integrations");
    await userEvent.click(within(choices).getByRole("radio", { name: /Operational cash/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(posted(fetcher)).toEqual([expect.objectContaining({ legalEntityId: COMPANY, source: "operational_cash", expectedVersion: 0, commandId: expect.any(String) })]));
  });
});
