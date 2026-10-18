import { BadGatewayException, BadRequestException, ConflictException, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Reads a connected company's P&L or cash flow report through the integration service, which holds the accounting
 * system's grant (Wodana never calls QuickBooks or Zoho Books itself here). Business Core has already checked who asked.
 * Nothing about the request or the answer is logged.
 */

export type AccountingProviderKind = "quickbooks" | "zoho_books";
export type ProviderReportRequest = {
  workspaceId: string; connectionId: string; provider: AccountingProviderKind; report: "profit_and_loss" | "cash_flow";
  basis: "accrual" | "cash"; columns: "total" | "month"; periods: Array<{ from: string; to: string }>;
};
export type ProviderReport = { from: string; to: string; data: Record<string, unknown> };
export type ProviderReportResponse = { provider: AccountingProviderKind; currency: string | null; reports: ProviderReport[] };

/** Why a statement couldn't be read from an accounting system; each has one sentence and one next step. */
export const STATEMENT_SOURCE_ERRORS = ["not_connected", "reconnect", "busy", "unavailable", "refused", "unsupported"] as const;
export type StatementSourceErrorCode = (typeof STATEMENT_SOURCE_ERRORS)[number];

const MESSAGES: Record<StatementSourceErrorCode, string> = {
  not_connected: "This company isn't connected to the accounting system. Connect it in Settings › Accounting.",
  reconnect: "The accounting connection needs to be connected again before its reports can be read.",
  busy: "The accounting system is busy. Try again in a minute.",
  unavailable: "The accounting system didn't answer. Try again shortly.",
  refused: "The accounting system's report couldn't be read. Check the connection and try again.",
  unsupported: "The accounting system's reports cover the whole company. Project statements come from Wodana's records or the Ledger.",
};

/** Where a person fixes a connection (Settings › Integrations). */
export const RECONNECT_HREF = "/workspace/integrations";

export class StatementSourceError extends Error {
  constructor(readonly code: StatementSourceErrorCode, message: string = MESSAGES[code]) { super(message); }
}

/** The error as an HTTP answer the web shows with the shared ErrorState: what happened and, when it helps, Reconnect. */
export function statementSourceHttpError(error: StatementSourceError): HttpException {
  const reconnect = error.code === "reconnect" || error.code === "not_connected";
  const body = { message: error.message, code: `statement_source_${error.code}`, ...(reconnect ? { action: { kind: "reconnect", href: RECONNECT_HREF } } : {}) };
  if (error.code === "unsupported") return new BadRequestException(body);
  if (reconnect) return new ConflictException(body);
  if (error.code === "busy") return new HttpException(body, HttpStatus.TOO_MANY_REQUESTS);
  return new BadGatewayException(body);
}

/** The integration service's answer code as one of ours. */
export function sourceErrorFor(status: number, code: string | null): StatementSourceErrorCode {
  if (code === "refresh_in_progress" || code === "provider_rate_limited" || status === 429) return "busy";
  if (code === "provider_unavailable" || status === 503 || status === 504) return "unavailable";
  if (code === "provider_request_failed" || code === "provider_invalid_response") return "refused";
  if (status === 404) return "not_connected";
  if (status === 409 || status === 401 || status === 403) return "reconnect";
  return "refused";
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Checks the integration service's answer has the shape the mappers read; anything else is refused. */
export function parseReportResponse(payload: unknown, request: ProviderReportRequest): ProviderReportResponse {
  if (!isRecord(payload) || payload.provider !== request.provider || !Array.isArray(payload.reports)) throw new StatementSourceError("refused");
  const reports = payload.reports.map((item) => {
    if (!isRecord(item) || typeof item.from !== "string" || typeof item.to !== "string" || !isRecord(item.data)) throw new StatementSourceError("refused");
    return { from: item.from, to: item.to, data: item.data };
  });
  const currency = typeof payload.currency === "string" && /^[A-Z]{3}$/.test(payload.currency) ? payload.currency : null;
  return { provider: request.provider, currency, reports };
}

@Injectable()
export class ProviderReportsClient {
  constructor(private readonly config: ConfigService) {}

  async fetch(request: ProviderReportRequest): Promise<ProviderReportResponse> {
    const base = this.config.get<string>("INTELLIGENCE_API_URL") ?? "http://127.0.0.1:8001/api/v1";
    const token = this.config.get<string>("BUSINESS_CORE_INTERNAL_TOKEN");
    if (!token) throw new StatementSourceError("unavailable", "Accounting reports aren't set up for this Wodana yet.");
    const response = await fetch(`${base.replace(/\/$/, "")}/integrations/providers/internal/accounting/reports`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-wodana-internal-token": token },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => null);
    if (!response) throw new StatementSourceError("unavailable");
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const code = isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string" ? payload.error.code : null;
      throw new StatementSourceError(sourceErrorFor(response.status, code));
    }
    return parseReportResponse(payload, request);
  }
}
