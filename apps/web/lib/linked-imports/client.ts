/** Linked spreadsheet imports (stock lists, product lists, supplier lists): the API for one workspace. */

export type ImportTarget = "stock" | "catalog" | "suppliers";
export type ImportSource = "upload" | "google_sheet";
export type ImportSchedule = "off" | "hourly" | "daily";
/** A tab as read: its cells as text; cell links ("row:column", 0-based); the block titles the browser worked out (by heading row); hidden in the sheet. */
export type SourceSheet = { name: string; rows: string[][]; links?: Record<string, string>; titles?: Record<string, string>; hidden?: boolean };
/** Columns to fields; the tabs chosen; suppliers: each tab's company, and only filling in what known suppliers miss. */
export type ColumnMapping = { columns: Record<string, string>; tabs?: string[]; entities?: Record<string, string>; fillOnly?: boolean };

export type ImportRun = {
  id: string; at: string; status: "applied" | "partial" | "failed"; trigger: "manual" | "schedule";
  added: number; changed: number; unchanged: number; errors: number; missing: number; message: string; byName: string | null;
};
export type ImportLink = {
  id: string; target: ImportTarget; name: string; source: ImportSource; catalogId: string | null; locationId: string | null; locationName: string | null;
  itemType: string | null; setsStock: boolean; legalEntityId?: string | null;
  /** Catalog: the sheet's prices are approved list prices (live at once, not drafted for review). */
  approvedPrices?: boolean; legalEntityName?: string | null; connectionId: string | null; spreadsheetId: string | null; sheetName: string | null; mapping: ColumnMapping;
  schedule: ImportSchedule; nextRunAt: string | null; ownerId: string; ownerName: string; status: string; version: number; lastRun?: ImportRun | null;
};
export type GoogleConnection = { id: string; name: string; account: string | null; driveFile: boolean };
export type ImportOverview = {
  links: ImportLink[]; canManage: boolean; connections: GoogleConnection[]; locations: Array<{ id: string; name: string; isDefault: boolean }>; currency: string;
  /** Suppliers: the companies a supplier list can be for. */
  entities?: Array<{ id: string; name: string }>;
  /** Catalog: whether the member may import prices as approved list prices. */
  canApprovePrices?: boolean;
};
export type RowOutcome = "added" | "changed" | "unchanged" | "error" | "missing";
export type PlanRow = { sheet: string; line: number | null; key: string; name: string; outcome: RowOutcome; changes?: string[]; message: string };
export type ImportPreview = {
  fingerprint: string; skippedTabs: string[];
  /** Catalog: prices go live as approved list prices, or were asked to but stay drafts (the member can't approve prices). */
  prices?: { approved: boolean; refused: boolean };
  summary: { added: number; changed: number; unchanged: number; errors: number; missing: number };
  rows: PlanRow[];
};
export type ImportDetail = {
  link: ImportLink; runs: ImportRun[]; rows: PlanRow[]; canManage: boolean;
  /** Right after a catalog run: the item each sheet row went to, and how many pictures it has. */
  records?: Array<{ sheet: string; line: number; recordId: string; images: number }>;
};
export type SheetRead = { title: string; sheets: SourceSheet[]; rowCounts: Record<string, number> };
export type PickerConfig = { configured: boolean; apiKey: string; appId: string };

export class ImportRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ImportRequestError(typeof data?.message === "string" ? data.message : "", response.status);
  return data as T;
}

export function linkedImportsApi(workspaceId: string) {
  const at = (path: string, query: Record<string, string> = {}) => `/api/linked-imports${path ? `/${path}` : ""}?${new URLSearchParams({ workspaceId, ...query })}`;
  return {
    overview: (target: ImportTarget, catalogId?: string) => request<ImportOverview>(at("", { target, ...(catalogId ? { catalogId } : {}) })),
    detail: (linkId: string) => request<ImportDetail>(at(linkId)),
    /** A picked Google Sheet's tabs and first rows, to map its columns. */
    source: (input: { target: ImportTarget; connectionId: string; spreadsheetId: string }) => request<SheetRead>(at("source"), "POST", input),
    preview: (input: Record<string, unknown>) => request<ImportPreview>(at("preview"), "POST", input),
    /** Saves the link and applies it now; replayed safely by `runId`. */
    apply: (input: Record<string, unknown>) => request<ImportDetail>(at(""), "POST", input),
    refresh: (linkId: string, input: Record<string, unknown>) => request<ImportDetail>(at(`${linkId}/refresh`), "POST", input),
    settings: (linkId: string, input: Record<string, unknown>) => request<ImportDetail | { archived: true }>(at(`${linkId}/settings`), "POST", input),
    pickerConfig: () => request<PickerConfig>(at("picker")),
    pickerToken: (connectionId: string) => request<{ accessToken: string; expiresIn: number; accountEmail: string }>(at("picker"), "POST", { connectionId }),
  };
}
export type LinkedImportsApi = ReturnType<typeof linkedImportsApi>;
