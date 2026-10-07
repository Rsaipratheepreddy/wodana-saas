import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { JournalOptions, OpeningPreview } from "@/lib/books/settings-client";
import { ManualJournalEditor, OpeningBalanceImport } from "./index";
import { fromUnits, lineTotals, toUnits } from "./journal-amounts";

const COMPANY = "00000000-0000-4000-8000-0000000000e1";
const options: JournalOptions = {
  company: { id: COMPANY, name: "Studio Interiors LLC", currency: "AED", decimals: 2 },
  settings: { enabled: true, startDate: "2026-10-01", lockDate: "2026-10-05" },
  accounts: [
    { id: "acc-1100", code: "1100", name: "Bank", type: "asset", isControl: false, allowManual: true },
    { id: "acc-1200", code: "1200", name: "Trade receivables", type: "asset", isControl: true, allowManual: false },
    { id: "acc-6120", code: "6120", name: "Rent", type: "expense", isControl: false, allowManual: true },
  ],
  projects: [], parties: [{ type: "vendor", id: "v1", name: "Nile Marble" }],
};

const mount = (respond: (url: string, method: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, status: 200,
    json: async () => respond(url, init?.method ?? "GET", typeof init?.body === "string" ? JSON.parse(init.body) : undefined) }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};

describe("journal amounts", () => {
  it("adds exact decimals, never floats", () => {
    expect(toUnits("0.1")! + toUnits("0.2")!).toBe(toUnits("0.3"));
    expect(toUnits("1.23456")).toBeNull();
    expect(fromUnits(15005000n)).toBe("1500.5000");
    expect(lineTotals([{ debit: "100", credit: "" }, { debit: "", credit: "60" }])).toMatchObject({ balanced: false, difference: 400000n });
  });
});

describe("manual journal editor", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the debit and credit totals and whether they balance, and offers only accounts open to manual entries", async () => {
    mount(() => options);
    render(<DesignSystemProvider><ManualJournalEditor workspaceId="w" legalEntityId={COMPANY} /></DesignSystemProvider>);
    const debits = await screen.findAllByLabelText("Debit", { selector: "input" });
    const credits = screen.getAllByLabelText("Credit", { selector: "input" });
    expect(screen.getByRole("status").getAttribute("data-state")).toBe("empty");

    await userEvent.type(debits[0], "100");
    await userEvent.type(credits[1], "60");
    await userEvent.tab();
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Off by .*40\.00/));
    expect(screen.getByRole("button", { name: "Submit for approval" }).getAttribute("data-disabled") ?? screen.getByRole("button", { name: "Submit for approval" }).getAttribute("disabled"))
      .not.toBeNull();

    await userEvent.clear(credits[1]);
    await userEvent.type(credits[1], "100");
    await userEvent.tab();
    await waitFor(() => expect(screen.getByRole("status").getAttribute("data-state")).toBe("balanced"));
    expect(screen.getByRole("status").textContent).toBe("Balanced");

    // The account choices: open to manual entries only (receivables is posted by its own records).
    const table = screen.getByRole("table", { name: "Journal lines", hidden: true });
    const choices = [...table.querySelectorAll("select")][0];
    const labels = [...(choices?.querySelectorAll("option") ?? [])].map((option) => option.textContent);
    expect(labels).toContain("6120 · Rent");
    expect(labels).not.toContain("1200 · Trade receivables");
    // Save sits at the bottom end, after the lines.
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});

describe("opening balance import", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the file, lists every problem by its row and keeps Submit off until it balances", async () => {
    const preview: OpeningPreview = {
      lines: [{ row: 2, accountId: "acc-1100", code: "1100", name: "Bank", debit: "50000.0000", credit: "0.0000" },
        { row: 3, accountId: null, code: "9999", name: "Mystery", debit: "0.0000", credit: "100.0000" }],
      errors: [{ row: 3, message: "There is no account 9999" }, { row: null, message: "Debits 50000.0000 and credits 100.0000 differ by 49900.0000." }],
      debit: "50000.0000", credit: "100.0000", balanced: false, journalDate: "2026-10-01", asAt: "2026-09-30",
    };
    const fetcher = mount((url, method, body) => {
      if (url.includes("/opening-preview")) return { ...preview, received: body };
      return null;
    });
    render(<DesignSystemProvider><OpeningBalanceImport workspaceId="w" legalEntityId={COMPANY} /></DesignSystemProvider>);
    const file = new File(["Code,Account,Debit,Credit\n1100,Bank,50000,\n9999,Mystery,,100\n"], "tb.csv", { type: "text/csv" });
    await userEvent.upload(screen.getByLabelText("Choose the trial balance file", { selector: "input" }), file);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Row 3: There is no account 9999")).toBeTruthy();
    expect(within(alert).getByText(/differ by 49900/)).toBeTruthy();
    expect(screen.getByText("Balances at 2026-09-30, posted on 2026-10-01")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Submit for approval" });
    expect(submit.getAttribute("data-disabled") ?? submit.getAttribute("disabled")).not.toBeNull();
    const sent = fetcher.mock.calls.find(([url]) => String(url).includes("/opening-preview"))!;
    expect(JSON.parse(String(sent[1]!.body))).toMatchObject({ legalEntityId: COMPANY, csv: expect.stringContaining("9999,Mystery") });
  });
});
