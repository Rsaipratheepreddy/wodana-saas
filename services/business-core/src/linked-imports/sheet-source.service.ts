import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SourceSheet } from "./linked-import-source";

export class SheetSourceError extends Error {}

const UNREADABLE = "Wodana couldn't read the sheet. Check the Google connection and that the sheet is still shared with it.";
const RECONNECT = "Google isn't connected anymore. Reconnect it in Connections, then refresh the import.";
/** The integration service's own sentences for a sheet it can't open (not Google's words). */
const WODANA_SHEET_CODES = new Set(["sheet_unavailable", "drive_file_not_granted", "sheet_tab_missing"]);

/**
 * What to tell the person (and the import's owner, in its notice) when the sheet can't be read: Wodana's sentence for
 * the code, never Google's own text. A revoked or expired Google access asks to reconnect.
 */
export function sheetErrorMessage(code: unknown, message: unknown): string {
  if (code === "reconnect_required" || code === "credential_missing" || code === "refresh_token_missing") return RECONNECT;
  if (typeof code === "string" && WODANA_SHEET_CODES.has(code) && typeof message === "string" && message.trim()) return message;
  return UNREADABLE;
}

export type SheetRequest = { workspaceId: string; connectionId: string; spreadsheetId: string; sheetName?: string | null; previewRows?: number };
export type SheetRead = { title: string; sheets: SourceSheet[]; rowCounts: Record<string, number> };

/**
 * Reads a linked Google Sheet through the integration service, which holds the workspace's Google grant
 * (drive.file: only the files someone picked for Wodana). Wodana never calls Google itself here.
 */
@Injectable()
export class SheetSourceService {
  constructor(private readonly config: ConfigService) {}

  async read(input: SheetRequest): Promise<SheetRead> {
    const base = this.config.get<string>("INTELLIGENCE_API_URL") ?? "http://127.0.0.1:8001/api/v1";
    const token = this.config.get<string>("BUSINESS_CORE_INTERNAL_TOKEN");
    if (!token) throw new SheetSourceError("Linked Google Sheets aren't set up for this Wodana yet.");
    const response = await fetch(`${base.replace(/\/$/, "")}/integrations/google/internal/sheets/read`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wodana-internal-token": token },
      body: JSON.stringify({ workspaceId: input.workspaceId, connectionId: input.connectionId, spreadsheetId: input.spreadsheetId, sheetName: input.sheetName ?? null,
        previewRows: input.previewRows ?? null }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!response) throw new SheetSourceError("Google didn't answer. Try again in a few minutes.");
    const payload = await response.json().catch(() => null) as { title?: unknown; sheets?: unknown; rowCounts?: unknown; error?: { code?: unknown; message?: unknown }; detail?: unknown } | null;
    if (!response.ok) throw new SheetSourceError(sheetErrorMessage(payload?.error?.code, payload?.error?.message));
    if (!payload || typeof payload.title !== "string" || !Array.isArray(payload.sheets)) throw new SheetSourceError("Google returned something Wodana can't read.");
    return { title: payload.title, sheets: payload.sheets as SourceSheet[], rowCounts: (payload.rowCounts && typeof payload.rowCounts === "object" ? payload.rowCounts : {}) as Record<string, number> };
  }
}
