import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { ImportLink, ImportOverview } from "@/lib/linked-imports/client";
import { LinkedImportDialog } from "./linked-import-dialog";

const WS = "11111111-1111-4111-8111-111111111111";
const overview = (patch: Partial<ImportOverview> = {}): ImportOverview => ({
  links: [], canManage: true, connections: [], locations: [{ id: "w1", name: "Main warehouse", isDefault: true }, { id: "s1", name: "Showroom", isDefault: false }], currency: "AED", ...patch,
});
const googleLink: ImportLink = {
  id: "22222222-2222-4222-8222-222222222222", target: "stock", name: "Factory stock", source: "google_sheet", catalogId: null, locationId: "w1", locationName: "Main warehouse", itemType: null,
  setsStock: true, connectionId: "c1", spreadsheetId: "sheet-1234567890", sheetName: null, mapping: { columns: { Code: "code", Qty: "quantity" } }, schedule: "hourly",
  nextRunAt: null, ownerId: "u1", ownerName: "Sam", status: "active", version: 3,
  lastRun: { id: "r1", at: new Date().toISOString(), status: "partial", trigger: "schedule", added: 1, changed: 2, unchanged: 40, errors: 1, missing: 0, message: "", byName: null },
};
const mount = (respond: (url: string, method: string, body: Record<string, unknown> | undefined) => unknown) => {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const value = respond(String(url), init?.method ?? "GET", typeof init?.body === "string" ? JSON.parse(init.body) : undefined);
    return value instanceof Error ? { ok: false, status: 409, json: async () => ({ message: value.message }) } : { ok: true, status: 200, json: async () => value };
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
};
const posts = (fetcher: ReturnType<typeof mount>) => fetcher.mock.calls.filter(([, init]) => init?.method === "POST").map(([url, init]) => ({ url: String(url), body: JSON.parse(String(init!.body)) }));
const open = (props: Partial<Parameters<typeof LinkedImportDialog>[0]> = {}) => {
  const onImported = vi.fn();
  render(<DesignSystemProvider><LinkedImportDialog isOpen onClose={() => undefined} onImported={onImported} target="stock" workspaceId={WS} {...props} /></DesignSystemProvider>);
  return onImported;
};

describe("linked import", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uploads a stock list, maps its columns, previews every row and applies it", async () => {
    const fetcher = mount((url, method) => {
      if (url.includes("/picker")) return { configured: false, apiKey: "", appId: "" };
      if (url.includes("/preview")) return { fingerprint: "f".repeat(64), skippedTabs: [], summary: { added: 1, changed: 0, unchanged: 0, errors: 1, missing: 0 },
        rows: [{ sheet: "stock.csv", line: 3, key: "MAT-002", name: "Velvet", outcome: "error", message: "Quantity isn't a number (ten).", changes: [] },
          { sheet: "stock.csv", line: 2, key: "MAT-001", name: "Oak veneer", outcome: "added", message: "", changes: ["Main warehouse: 0 → 120 sqm"] }] };
      if (method === "POST") return { link: { ...googleLink, source: "upload", schedule: "off", name: "stock" }, runs: [{ ...googleLink.lastRun!, trigger: "manual", byName: "Rana", changed: 0, unchanged: 0 }], rows: [], canManage: true };
      return overview();
    });
    const onImported = open();
    const dialog = await screen.findByRole("dialog", { name: "Import" });
    // Google isn't set up for this Wodana, so only a file can be imported.
    expect(within(dialog).queryByRole("button", { name: /Link a Google Sheet/ })).not.toBeInTheDocument();
    const csv = "Code,Item,Unit,Qty,Notes\nMAT-001,Oak veneer,sqm,120,x\nMAT-002,Velvet,m,ten,y\n";
    // jsdom's File has no text(); browsers do.
    await userEvent.upload(within(dialog).getByLabelText("Upload a spreadsheet"), Object.defineProperty(new File([csv], "stock.csv", { type: "text/csv" }), "text", { value: async () => csv }));
    expect(await within(dialog).findByRole("textbox", { name: /Name/ })).toHaveValue("stock");
    const columns = within(dialog).getByRole("list", { name: "Columns" });
    expect(within(columns).getAllByRole("listitem").map((row) => row.querySelector("strong")?.textContent)).toEqual(["Code", "Item", "Unit", "Qty", "Notes"]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Review" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.url).toContain("/api/linked-imports/preview"));
    expect(posts(fetcher).at(-1)!.body).toMatchObject({ target: "stock", source: "upload", name: "stock", locationId: "w1", setsStock: true, schedule: "off",
      mapping: { columns: { Code: "code", Item: "name", Unit: "unit", Qty: "quantity" } },
      sheets: [{ name: "stock.csv", rows: [["Code", "Item", "Unit", "Qty"], ["MAT-001", "Oak veneer", "sqm", "120"], ["MAT-002", "Velvet", "m", "ten"]] }] });
    // Problems come first, each with its row and why.
    const rows = within(await within(dialog).findByRole("list", { name: "Rows" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Needs a fix");
    expect(rows[0]).toHaveTextContent("Quantity isn't a number (ten).");
    expect(rows[1]).toHaveTextContent("Main warehouse: 0 → 120 sqm");
    await userEvent.click(within(dialog).getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
    const applied = posts(fetcher).find((call) => /\/api\/linked-imports\?/.test(call.url))!;
    expect(applied.body).toMatchObject({ expectedFingerprint: "f".repeat(64), target: "stock", source: "upload" });
    expect(applied.body.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows a linked sheet's last refresh and changes its schedule, its stock setting and refreshes it now", async () => {
    const fetcher = mount((url, method) => {
      if (url.includes("/picker")) return { configured: true, apiKey: "k", appId: "1" };
      if (method === "POST" || url.includes(googleLink.id)) return { link: googleLink, runs: [googleLink.lastRun], rows: [{ sheet: "Stock", line: 9, key: "MAT-9", name: "Brass", outcome: "error", message: "No item code." }], canManage: true };
      return overview({ links: [googleLink], connections: [{ id: "c1", name: "Google", account: "ops@example.com", driveFile: true }] });
    });
    open();
    const card = (await screen.findByText("Factory stock")).closest("li")!;
    expect(card).toHaveTextContent("Google Sheet");
    expect(card).toHaveTextContent("Some rows need a fix");
    expect(card).toHaveTextContent("1 new · 2 changed · 40 unchanged · 1 need a fix · 0 not in sheet");
    await userEvent.click(within(card).getByRole("switch", { name: "Sheet sets stock quantities" }));
    await waitFor(() => expect(posts(fetcher).at(-1)).toMatchObject({ body: { version: 3, setsStock: false } }));
    expect(posts(fetcher).at(-1)!.url).toContain(`/api/linked-imports/${googleLink.id}/settings`);
    await userEvent.click(within(card).getByRole("button", { name: "Refresh now" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.url).toContain(`/api/linked-imports/${googleLink.id}/refresh`));
    // The refreshed link opens on the rows its run left: problems first.
    expect(await within(card).findByText("No item code.")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Hide rows" }));
    expect(within(card).queryByText("No item code.")).not.toBeInTheDocument();
  });

  it("takes a new version of an uploaded sheet through the link's own mapping and settings", async () => {
    const uploaded: ImportLink = { ...googleLink, source: "upload", schedule: "off", connectionId: null, spreadsheetId: null, locationId: "s1", setsStock: false, name: "Showroom list" };
    const fetcher = mount((url) => {
      if (url.includes("/picker")) return { configured: false, apiKey: "", appId: "" };
      if (url.includes("/preview")) return { fingerprint: "a".repeat(64), skippedTabs: [], summary: { added: 0, changed: 0, unchanged: 1, errors: 0, missing: 0 }, rows: [] };
      return overview({ links: [uploaded] });
    });
    open();
    const card = (await screen.findByText("Showroom list")).closest("li")!;
    const csv = "Code,Qty\nMAT-001,4\n";
    await userEvent.upload(within(card).getByLabelText("Upload a new version"), Object.defineProperty(new File([csv], "v2.csv", { type: "text/csv" }), "text", { value: async () => csv }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.url).toContain("/api/linked-imports/preview"));
    expect(posts(fetcher).at(-1)!.body).toMatchObject({ linkId: uploaded.id, version: 3, name: "Showroom list", locationId: "s1", setsStock: false, mapping: uploaded.mapping });
    expect(await screen.findByText("Nothing changes.")).toBeInTheDocument();
  });

  it("offers a Google Sheet only once the connection may read picked files", async () => {
    mount((url) => (url.includes("/picker") ? { configured: true, apiKey: "k", appId: "1" } : overview({ connections: [{ id: "c1", name: "Google", account: null, driveFile: false }] })));
    open();
    const link = await screen.findByRole("button", { name: /Link a Google Sheet/ });
    expect(link).toBeDisabled();
    expect(screen.getByText("Turn on Drive files for the Google connection in Connections first.")).toBeInTheDocument();
  });

  it("imports a supplier list matched by name, as one company's list", async () => {
    const fetcher = mount((url) => {
      if (url.includes("/picker")) return { configured: false, apiKey: "", appId: "" };
      if (url.includes("/preview")) return { fingerprint: "f".repeat(64), skippedTabs: [], summary: { added: 1, changed: 0, unchanged: 0, errors: 0, missing: 0 },
        rows: [{ sheet: "suppliers.csv", line: 2, key: "SIOM Marble", name: "SIOM Marble", outcome: "added", message: "", changes: [] }] };
      return overview({ locations: [], entities: [{ id: "e1", name: "Interiors" }, { id: "e2", name: "Factory" }] });
    });
    open({ target: "suppliers" });
    const dialog = await screen.findByRole("dialog", { name: "Import" });
    const csv = "Company Name,Contact Number,TRN\nSIOM Marble,052 846 6806,100123456700003\n";
    await userEvent.upload(within(dialog).getByLabelText("Upload a spreadsheet"), Object.defineProperty(new File([csv], "suppliers.csv", { type: "text/csv" }), "text", { value: async () => csv }));
    await within(dialog).findByRole("list", { name: "Columns" });
    await userEvent.click(within(dialog).getByRole("button", { name: /Company/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Factory" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Review" }));
    await waitFor(() => expect(posts(fetcher).at(-1)!.url).toContain("/api/linked-imports/preview"));
    expect(posts(fetcher).at(-1)!.body).toMatchObject({ target: "suppliers", source: "upload", legalEntityId: "e2",
      mapping: { columns: { "Company Name": "name", "Contact Number": "phone", TRN: "taxNumber" } } });
    expect(await within(dialog).findByText("SIOM Marble")).toBeInTheDocument();
  });
});
