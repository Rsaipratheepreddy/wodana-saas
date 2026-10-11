import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalStatementSources, externalStatementProvider, MAX_MONTHS } from "./external-statements";
import { parseReportResponse, ProviderReportsClient, sourceErrorFor, StatementSourceError, statementSourceHttpError, type ProviderReportRequest,
  type ProviderReportResponse } from "./provider-reports.client";

const fixture = (name: string) => JSON.parse(readFileSync(resolve(__dirname, "fixtures", name), "utf8")) as Record<string, unknown>;
const WORKSPACE = "6f1c2c38-08b1-4d7e-9a43-0c7f3f1b8a11";
const ENTITY = "2b9d7d0e-6f43-4a51-8f0e-5a3f4c2d1e10";
const CONNECTION = "9a0f2d3e-1b4c-4d5e-8f6a-7b8c9d0e1f2a";

function fakeDb(link: Record<string, string> | null) {
  const queries: unknown[][] = [];
  return { queries, db: { query: async (_sql: string, values: unknown[]) => { queries.push(values); return { rows: link ? [link] : [] }; } } as never };
}
function fakeReports(answer: (request: ProviderReportRequest) => ProviderReportResponse) {
  const requests: ProviderReportRequest[] = [];
  return { requests, client: { fetch: async (request: ProviderReportRequest) => { requests.push(request); return answer(request); } } as unknown as ProviderReportsClient };
}
const LINK = { connectionId: CONNECTION, companyName: "Palm Interiors LLC", baseCurrency: "AED" };
const now = () => new Date("2026-11-02T10:00:00.000Z");

describe("QuickBooks and Zoho Books as statement sources", () => {
  it("reads the company's QuickBooks P&L through the connection it posts to, on the asked basis", async () => {
    const { db, queries } = fakeDb(LINK);
    const reports = fakeReports(() => ({ provider: "quickbooks", currency: "USD", reports: [{ from: "2026-10-01", to: "2026-10-31", data: fixture("quickbooks-profit-and-loss.json") }] }));
    const provider = externalStatementProvider("quickbooks", { db, workspaceId: WORKSPACE, reports: reports.client, now });
    const statement = await provider.profitAndLoss({ legalEntityId: ENTITY, from: "2026-10-01", to: "2026-10-31", basis: "cash" });
    expect(queries[0]).toEqual([WORKSPACE, ENTITY, "quickbooks"]);
    expect(reports.requests).toEqual([{ workspaceId: WORKSPACE, connectionId: CONNECTION, provider: "quickbooks", report: "profit_and_loss", basis: "cash",
      columns: "total", periods: [{ from: "2026-10-01", to: "2026-10-31" }] }]);
    expect(statement).toMatchObject({ source: "quickbooks", sourceLabel: "QuickBooks · Palm Interiors LLC", basis: "cash", currency: "USD", legalEntityId: ENTITY,
      projectId: null, generatedAt: "2026-11-02T10:00:00.000Z" });
    expect(statement.totals.netProfit).toEqual(["2270.9200"]);
    expect(await provider.capabilities()).toEqual({ accrual: true, cash: true, drillDown: false, cashAccounts: false, forecast: false });
  });

  it("reads a Zoho Books cash flow one month at a time and assumes the company's currency when Zoho gives none (noted)", async () => {
    const { db } = fakeDb(LINK);
    const reports = fakeReports((request) => ({ provider: "zoho_books", currency: null, reports: request.periods.map((period, index) => ({ ...period,
      data: fixture(index === 0 ? "zoho-books-cash-flow-september.json" : "zoho-books-cash-flow-october.json") })) }));
    const provider = externalStatementProvider("zoho_books", { db, workspaceId: WORKSPACE, reports: reports.client, now });
    const statement = await provider.cashFlow({ legalEntityId: ENTITY, from: "2026-09-01", to: "2026-10-31", basis: "accrual" });
    expect(reports.requests[0]).toMatchObject({ report: "cash_flow", columns: "month", periods: [{ from: "2026-09-01", to: "2026-09-30" }, { from: "2026-10-01", to: "2026-10-31" }] });
    expect(statement.currency).toBe("AED");
    expect(statement.notes).toEqual(["The accounting system didn't say its currency; AED is assumed."]);
    expect(statement.closing).toEqual(["4950.0000", "5320.9200"]);
  });

  it("says the company isn't connected, keeps to company level and refuses too long a cash flow, before calling anything", async () => {
    const none = fakeReports(() => { throw new Error("not called"); });
    const off = externalStatementProvider("quickbooks", { db: fakeDb(null).db, workspaceId: WORKSPACE, reports: none.client });
    await expect(off.profitAndLoss({ legalEntityId: ENTITY, from: "2026-10-01", to: "2026-10-31", basis: "accrual" })).rejects.toMatchObject({ code: "not_connected" });
    const on = externalStatementProvider("quickbooks", { db: fakeDb(LINK).db, workspaceId: WORKSPACE, reports: none.client });
    await expect(on.profitAndLoss({ legalEntityId: ENTITY, projectId: "p-1", from: "2026-10-01", to: "2026-10-31", basis: "accrual" }))
      .rejects.toMatchObject({ code: "unsupported" });
    await expect(on.cashFlow({ legalEntityId: ENTITY, from: "2024-01-01", to: "2026-10-31", basis: "accrual" })).rejects.toThrow(`Choose at most ${MAX_MONTHS} months.`);
    await expect(on.cashFlow({ legalEntityId: ENTITY, from: "2026-10-31", to: "2026-10-01", basis: "accrual" })).rejects.toMatchObject({ code: "refused" });
    expect(none.requests).toEqual([]);
  });

  it("turns a report it can't read into a refusal, never a crash with provider text", async () => {
    const reports = fakeReports(() => ({ provider: "quickbooks", currency: "USD", reports: [{ from: "2026-10-01", to: "2026-10-31",
      data: { Columns: { Column: [{ ColType: "Account" }, { ColType: "Money" }] }, Rows: { Row: [{ group: "Income", Rows: { Row: [{ ColData: [{ value: "Sales" }, { value: "lots" }] }] } }] } } }] }));
    const provider = externalStatementProvider("quickbooks", { db: fakeDb(LINK).db, workspaceId: WORKSPACE, reports: reports.client });
    await expect(provider.profitAndLoss({ legalEntityId: ENTITY, from: "2026-10-01", to: "2026-10-31", basis: "accrual" })).rejects.toMatchObject({ code: "refused" });
  });
});

describe("registering the sources with the statements page", () => {
  it("offers QuickBooks and Zoho Books only to a company that posts to them, named after the company", async () => {
    const sources = new ExternalStatementSources(fakeReports(() => { throw new Error("not called"); }).client);
    const [zoho, quickbooks] = sources.adapters();
    expect([zoho.source, quickbooks.source]).toEqual(["zoho_books", "quickbooks"]);
    const connected = fakeDb(LINK);
    expect(await quickbooks.availability({ db: connected.db, workspaceId: WORKSPACE, legalEntityId: ENTITY, currency: "AED" }))
      .toEqual({ available: true, label: "QuickBooks · Palm Interiors LLC" });
    expect(connected.queries[0]).toEqual([WORKSPACE, ENTITY, "quickbooks"]);
    expect(await zoho.availability({ db: fakeDb(null).db, workspaceId: WORKSPACE, legalEntityId: ENTITY })).toEqual({ available: false, label: null });
    expect(quickbooks.provider({ db: connected.db, workspaceId: WORKSPACE, legalEntityId: ENTITY }).source).toBe("quickbooks");
  });
});

describe("source errors", () => {
  it("map the integration service's codes to one next step each", () => {
    expect(sourceErrorFor(409, "reconnect_required")).toBe("reconnect");
    expect(sourceErrorFor(409, "credential_missing")).toBe("reconnect");
    expect(sourceErrorFor(409, "refresh_in_progress")).toBe("busy");
    expect(sourceErrorFor(429, "provider_rate_limited")).toBe("busy");
    expect(sourceErrorFor(502, "provider_unavailable")).toBe("unavailable");
    expect(sourceErrorFor(502, "provider_request_failed")).toBe("refused");
    expect(sourceErrorFor(404, "business_core_error")).toBe("not_connected");
  });

  it("answer with the shared error body, and Reconnect where reconnecting fixes it", () => {
    const reconnect = statementSourceHttpError(new StatementSourceError("reconnect"));
    expect(reconnect.getStatus()).toBe(409);
    expect(reconnect.getResponse()).toEqual({ message: "The accounting connection needs to be connected again before its reports can be read.",
      code: "statement_source_reconnect", action: { kind: "reconnect", href: "/workspace/integrations" } });
    expect(statementSourceHttpError(new StatementSourceError("busy")).getStatus()).toBe(429);
    expect(statementSourceHttpError(new StatementSourceError("unavailable")).getStatus()).toBe(502);
    expect(statementSourceHttpError(new StatementSourceError("unsupported")).getStatus()).toBe(400);
    expect(statementSourceHttpError(new StatementSourceError("refused")).getResponse()).not.toHaveProperty("action");
  });

  it("check the answer's shape", () => {
    const request = { workspaceId: WORKSPACE, connectionId: CONNECTION, provider: "quickbooks", report: "cash_flow", basis: "accrual", columns: "month", periods: [] } as ProviderReportRequest;
    expect(() => parseReportResponse({ provider: "zoho_books", reports: [] }, request)).toThrow(StatementSourceError);
    expect(() => parseReportResponse({ provider: "quickbooks", reports: [{ from: "x" }] }, request)).toThrow(StatementSourceError);
    expect(parseReportResponse({ provider: "quickbooks", currency: "usd", reports: [] }, request)).toEqual({ provider: "quickbooks", currency: null, reports: [] });
  });
});

describe("the integration service client", () => {
  afterEach(() => vi.unstubAllGlobals());
  const request: ProviderReportRequest = { workspaceId: WORKSPACE, connectionId: CONNECTION, provider: "zoho_books", report: "profit_and_loss", basis: "accrual",
    columns: "total", periods: [{ from: "2026-10-01", to: "2026-10-31" }] };
  const config = (values: Record<string, string>) => ({ get: (key: string) => values[key] }) as unknown as ConfigService;

  it("posts to the internal route with the internal token and returns the reports", async () => {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ provider: "zoho_books", currency: "AED", reports: [{ from: "2026-10-01", to: "2026-10-31", data: { code: "0" } }] }), { status: 200 });
    });
    const client = new ProviderReportsClient(config({ INTELLIGENCE_API_URL: "http://intel:8001/api/v1/", BUSINESS_CORE_INTERNAL_TOKEN: "t0ken-internal" }));
    expect(await client.fetch(request)).toEqual({ provider: "zoho_books", currency: "AED", reports: [{ from: "2026-10-01", to: "2026-10-31", data: { code: "0" } }] });
    expect(calls[0][0]).toBe("http://intel:8001/api/v1/integrations/providers/internal/accounting/reports");
    expect((calls[0][1].headers as Record<string, string>)["x-wodana-internal-token"]).toBe("t0ken-internal");
    expect(JSON.parse(String(calls[0][1].body))).toEqual(request);
  });

  it("reports a reconnect, an outage or a missing set-up without the token or the provider's text", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "reconnect_required", message: "t0ken-internal leaked" } }), { status: 409 }));
    const client = new ProviderReportsClient(config({ BUSINESS_CORE_INTERNAL_TOKEN: "t0ken-internal" }));
    const error = await client.fetch(request).catch((cause: unknown) => cause as StatementSourceError);
    expect(error).toMatchObject({ code: "reconnect" });
    expect(error.message).not.toContain("t0ken");
    vi.stubGlobal("fetch", async () => { throw new TypeError("connect ECONNREFUSED"); });
    await expect(client.fetch(request)).rejects.toMatchObject({ code: "unavailable" });
    await expect(new ProviderReportsClient(config({})).fetch(request)).rejects.toMatchObject({ code: "unavailable", message: "Accounting reports aren't set up for this Wodana yet." });
  });
});
