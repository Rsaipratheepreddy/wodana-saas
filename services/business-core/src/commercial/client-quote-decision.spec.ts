import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { ClientPortalService } from "./client-portal.service";
import { freezeHash } from "./commercial.domain";
import type { CommercialData, Quote } from "./commercial.types";

const challengeId = "00000000-0000-4000-8000-000000000001";

function setup() {
  const quote: Quote = {
    id: "quote",
    number: 2,
    kind: "quotation",
    status: "issued",
    title: "Villa quotation",
    currency: "AED",
    validUntil: "2099-01-01",
    discount: 0,
    taxRate: 5,
    terms: "Terms",
    exclusions: "",
    lines: [
      { id: "base", room: "Living", title: "Base", specification: "", material: "", finish: "", quantity: 1, unit: "item", unitCost: 60, rate: 100 },
      { id: "option", room: "Living", title: "Upgrade", specification: "", material: "", finish: "", quantity: 1, unit: "item", unitCost: 20, rate: 50, optional: true },
    ],
    requestIds: [],
    paymentTerms: [],
    createdAt: "2026-09-18T00:00:00.000Z",
    issuedAt: "2026-09-18T01:00:00.000Z",
    approverId: "grant",
    total: 105,
  };
  quote.hash = freezeHash(quote);
  const data: CommercialData = {
    revision: 1,
    quotes: [quote],
    requests: [],
    agreement: null,
    payments: [],
    audit: [],
    ownerReview: null,
    dealFile: null,
    materialApprovals: [],
    release: null,
  };
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("client_portal_sessions")) return { rowCount: 1, rows: [{ phone: "+971555555555" }] };
      if (sql.includes("client_portal_grants")) return { rowCount: 1, rows: [{ id: "grant", caseId: "case", name: "Client", role: "approver" }] };
      return { rowCount: 0, rows: [] };
    }),
  } as unknown as PoolClient;
  const db = {
    query: vi.fn(async () => ({ rowCount: 1, rows: [{ workspaceId: "workspace", slug: "local", brand: {}, enabled: true, version: 1 }] })),
    tenantTransaction: vi.fn(async (_workspaceId: string, _actorId: string, work: (client: PoolClient) => unknown) => work(client)),
  };
  const commercial = {
    testMode: true,
    caseRecord: vi.fn(),
    load: vi.fn(async () => data),
    persist: vi.fn(),
  };
  const config = { get: vi.fn((key: string) => key === "PORTAL_OTP_SECRET" ? "x".repeat(32) : "test") };
  const service = new ClientPortalService(
    db as never,
    commercial as never,
    {} as never,
    config as never,
    {} as never,
    {} as never,
    {} as never,
  );
  vi.spyOn(service as never, "consume" as never).mockResolvedValue("+971555555555" as never);
  return { service, quote, commercial, data };
}

describe("client quotation decision", () => {
  it("persists exact selected-option evidence and safely replays the same command", async () => {
    const { service, quote, commercial } = setup();
    const input = { caseId: "case", action: "decision", quoteId: "quote", decision: "accept", selectedOptionLineIds: ["option"], challengeId, code: "123456", note: "" };
    await expect(service.command("local", "session-token", input)).resolves.toEqual({ ok: true });
    expect(quote).toMatchObject({
      status: "accepted",
      decisionChallengeId: challengeId,
      clientDecision: {
        decision: "accept",
        quoteHash: quote.hash,
        selectedOptionLineIds: ["option"],
        baseTotal: 105,
        optionsTotal: 52.5,
        acceptedTotal: 157.5,
        decidedBy: "Client",
      },
    });
    expect(commercial.persist).toHaveBeenCalledTimes(1);
    await expect(service.command("local", "session-token", input)).resolves.toEqual({ ok: true, replayed: true });
    expect(commercial.persist).toHaveBeenCalledTimes(1);
    await expect(service.command("local", "session-token", { ...input, selectedOptionLineIds: [] })).rejects.toThrow(/different decision/i);
  });

  it("accepts a structured response only from the approver assigned to its exact revision", async () => {
    const { service, data, commercial } = setup();
    data.requests.push({
      id: "request",
      number: 1,
      quoteId: "quote",
      title: "Confirm finish",
      detail: "Choose the exact finish for quotation V2.",
      status: "awaiting_decision",
      owner: "Account manager",
      dueDate: "2099-01-02",
      resolution: "",
      comments: [],
      createdAt: "2026-09-18T02:00:00.000Z",
      decisionRequest: {
        ownerMembershipId: "owner-membership",
        clientApproverGrantId: "grant",
        target: { type: "quotation", id: "quote", revision: 2, label: "Quotation V2" },
        allowedChoices: [
          { id: "choice-1", label: "Approve" },
          { id: "choice-2", label: "Request changes" },
        ],
        escalationMinutes: 60,
        notificationPolicy: { remindersEnabled: true, channels: ["in_app"] },
        decision: null,
      },
    });
    const input = { caseId: "case", action: "decision_response", requestId: "request", responseId: "response", choiceId: "choice-1", note: "Proceed" };

    await expect(service.command("local", "session-token", input)).resolves.toEqual({ ok: true });
    expect(data.requests[0]).toMatchObject({
      status: "resolved",
      resolution: "Approve · Proceed",
      decisionRequest: { decision: { responseId: "response", choiceId: "choice-1", decidedBy: "Client" } },
    });
    expect(commercial.persist).toHaveBeenCalledTimes(1);
    await expect(service.command("local", "session-token", input)).resolves.toEqual({ ok: true, replayed: true });
    expect(commercial.persist).toHaveBeenCalledTimes(1);
  });

  it("rejects a structured response from a different client approver", async () => {
    const { service, data } = setup();
    data.requests.push({
      id: "request",
      number: 1,
      title: "Confirm finish",
      detail: "Choose one.",
      status: "awaiting_decision",
      owner: "Account manager",
      dueDate: "2099-01-02",
      resolution: "",
      comments: [],
      createdAt: "2026-09-18T02:00:00.000Z",
      decisionRequest: {
        ownerMembershipId: "owner-membership",
        clientApproverGrantId: "another-grant",
        target: { type: "quotation", id: "quote", revision: 2, label: "Quotation V2" },
        allowedChoices: [{ id: "choice-1", label: "Approve" }, { id: "choice-2", label: "Request changes" }],
        escalationMinutes: null,
        notificationPolicy: { remindersEnabled: false, channels: ["in_app"] },
        decision: null,
      },
    });

    await expect(service.command("local", "session-token", {
      caseId: "case",
      action: "decision_response",
      requestId: "request",
      responseId: "response",
      choiceId: "choice-1",
      note: "",
    })).rejects.toThrow(/designated approver/i);
  });
});
