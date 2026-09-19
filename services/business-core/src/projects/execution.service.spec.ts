import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import type { HrmsAccessService } from "../hrms/hrms-access.service";
import { emptyProject } from "./execution.domain";
import { ExecutionService } from "./execution.service";
import type { ProjectNotificationsService } from "./project-notifications";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData, Quote } from "../commercial/commercial.types";

describe("ExecutionService optimistic commands", () => {
  it("rejects a stale project revision before reading or mutating dependencies", async () => {
    const query = vi.fn();
    const run = vi.fn(async (_actor, workspaceId, work) =>
      work({
        client: { query },
        workspaceId,
        userId: "user",
        membershipId: "member",
        permissions: new Set(["projects.manage"]),
      }),
    );
    const access = {
      run,
      require: vi.fn(),
      audit: vi.fn(),
    } as unknown as HrmsAccessService;
    const service = new ExecutionService(
      access,
      { notify: vi.fn() } as unknown as ProjectNotificationsService,
      { record: vi.fn() } as unknown as CrmEventsService,
    );
    const data = emptyProject();
    data.revision = 7;
    vi.spyOn(service, "row").mockResolvedValue({
      id: "project",
      caseId: "case",
      name: "Project",
      commercial: null,
      timezone: "Asia/Dubai",
    });
    vi.spyOn(service, "load").mockResolvedValue(data);

    await expect(
      service.command(
        { sub: "user" } as RequestActor,
        "workspace",
        "project",
        {
          action: "sync_variations",
          requestId: "stable-request-0001",
          revision: 6,
        },
      ),
    ).rejects.toThrow("Refresh and review");
    expect(query).not.toHaveBeenCalled();
  });

  it("applies an accepted controlled variation once and preserves the released baseline", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM workspace_memberships"))
        return { rowCount: 1, rows: [{ id: "member", name: "Project manager" }] };
      if (sql.includes("FROM project_resources"))
        return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });
    const audit = vi.fn();
    const run = vi.fn(async (_actor, workspaceId, work) =>
      work({
        client: { query },
        workspaceId,
        userId: "user",
        membershipId: "member",
        permissions: new Set(["projects.manage"]),
      }),
    );
    const service = new ExecutionService(
      { run, require: vi.fn(), audit } as unknown as HrmsAccessService,
      { notify: vi.fn() } as unknown as ProjectNotificationsService,
      { record: vi.fn().mockResolvedValue("event") } as unknown as CrmEventsService,
    );
    const variation = {
      id: "variation",
      number: 2,
      kind: "variation",
      direction: "addition",
      status: "accepted",
      title: "Additional shelves",
      currency: "AED",
      validUntil: "2026-12-31",
      discount: 0,
      taxRate: 0,
      terms: "Accepted variation",
      exclusions: "",
      lines: [{
        id: "variation-line",
        room: "Bedroom",
        title: "Additional shelves",
        quantity: 2,
        unit: "nos",
        rate: 50,
      }],
      paymentTerms: [],
      requestIds: ["change"],
      createdAt: "2026-09-18T00:00:00.000Z",
      total: 100,
    } as Quote;
    variation.hash = freezeHash(variation);
    variation.clientDecision = {
      decision: "accept",
      quoteHash: variation.hash,
      selectedOptionLineIds: [],
      baseTotal: 100,
      optionsTotal: 0,
      acceptedTotal: 100,
      decidedAt: "2026-09-18T00:00:00.000Z",
      decidedBy: "Client",
    };
    const commercial = {
      financeContext: {
        legalEntityId: "entity",
        currency: "AED",
      },
      quotes: [variation],
      requests: [{
        id: "change",
        number: 1,
        control: {
          kind: "addition",
          quoteIds: [variation.id],
          sourceLineIds: [],
          dispositions: [],
        },
      }],
      payments: [{
        id: "payment",
        sourceQuoteId: variation.id,
        legalEntityId: "entity",
        currency: "AED",
        title: "Variation deposit",
        amount: 100,
        dueDate: "2026-09-18",
        requiredForRelease: true,
        status: "verified",
        proof: "Bank receipt",
        reference: "RCT-100",
      }],
      receipts: [{
        id: "receipt",
        paymentId: "payment",
        legalEntityId: "entity",
        currency: "AED",
        amount: 100,
        source: "manual",
        status: "finance_verified",
        reference: "RCT-100",
        evidence: "Bank receipt",
        reportedAt: "2026-09-18T00:00:00.000Z",
        reportedBy: "Operations",
        verifiedAt: "2026-09-18T00:05:00.000Z",
        verifiedBy: "Finance",
      }],
      allocations: [{
        id: "allocation",
        receiptId: "receipt",
        paymentId: "payment",
        legalEntityId: "entity",
        currency: "AED",
        amount: 100,
        createdAt: "2026-09-18T00:00:00.000Z",
        createdBy: "Operations",
      }],
    } as unknown as CommercialData;
    const data = emptyProject();
    data.phase = "active";
    data.scope = {
      quoteId: "base",
      quoteNumber: 1,
      currency: "AED",
      value: 500,
      lines: [],
    };
    vi.spyOn(service, "row").mockResolvedValue({
      id: "project",
      caseId: "case",
      name: "Project",
      commercial,
      timezone: "Asia/Dubai",
    });
    vi.spyOn(service, "load").mockResolvedValue(data);

    const first = await service.command(
      { sub: "user" } as RequestActor,
      "workspace",
      "project",
      { action: "sync_variations", requestId: "stable-request-0002", revision: 0 },
    );
    expect(first.data.scope).toMatchObject({ quoteId: "base", value: 500 });
    expect(first.data.variations).toHaveLength(1);
    expect(first.data.variations?.[0]).toMatchObject({
      quoteId: "variation",
      quoteHash: variation.hash,
      value: 100,
    });
    expect(first.data.changeCases).toHaveLength(1);

    const second = await service.command(
      { sub: "user" } as RequestActor,
      "workspace",
      "project",
      { action: "sync_variations", requestId: "stable-request-0003", revision: 1 },
    );
    expect(second.data.variations).toHaveLength(1);
    expect(second.data.scope).toMatchObject({ quoteId: "base", value: 500 });
    expect(audit).toHaveBeenCalledTimes(2);
  });
});
