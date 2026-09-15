import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import { canonicalHash } from "../crm/shared/crm-types";
import type { PreProjectDefinitionService } from "../pre-projects/pre-project-definition.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import type { CatalogSellingPriceService } from "./catalog-selling-price.service";
import type { CommercialService } from "./commercial.service";
import type { CatalogPriceSnapshot, Quote, QuoteLine } from "./commercial.types";
import { QuotationComposerService } from "./quotation-composer.service";
import type { QuotationProposal, QuotationProposalItem } from "./quotation-composer";

const workspaceId = "123e4567-e89b-42d3-a456-426614174000";
const caseId = "223e4567-e89b-42d3-a456-426614174000";
const quoteId = "323e4567-e89b-42d3-a456-426614174000";
const runId = "423e4567-e89b-42d3-a456-426614174000";
const requestId = "523e4567-e89b-42d3-a456-426614174000";
const itemId = "623e4567-e89b-42d3-a456-426614174000";
const workId = "723e4567-e89b-42d3-a456-426614174000";
const catalogId = "823e4567-e89b-42d3-a456-426614174000";
const actor = {
  subject: "composer-user",
  email: "composer@example.com",
  displayName: "Composer User",
  provider: "development",
} as RequestActor;

const quote = (): Quote => ({
  id: quoteId,
  number: 1,
  kind: "quotation",
  status: "draft",
  title: "Proposal",
  currency: "AED",
  validUntil: "2099-01-01",
  discount: 0,
  taxRate: 5,
  terms: "Terms",
  exclusions: "",
  lines: [],
  rooms: [],
  requestIds: [],
  paymentTerms: [],
  createdAt: "2026-09-15T00:00:00.000Z",
  total: 0,
});

const emptyProposal = (): QuotationProposal => ({
  schemaVersion: 1,
  mode: "assistant",
  summary: "Proposal",
  intent: "Prepare catalog choices",
  items: [],
  coverage: { includedSourceIds: [], linkedSourceIds: [], unlinkedSourceIds: [] },
  notes: [],
});

function setup(query: ReturnType<typeof vi.fn>) {
  const client = { query } as unknown as PoolClient;
  const access = {
    withPermissions: vi.fn(async (_actor, _workspace, _permissions, work) =>
      work(client, { userId: "user-1", displayName: "Composer User" }),
    ),
  };
  const commercial = {
    caseRecord: vi.fn(),
    load: vi.fn(),
    persist: vi.fn(),
  };
  const definitions = { currentConfirmation: vi.fn() };
  const prices = { resolve: vi.fn() };
  const events = { record: vi.fn() };
  const service = new QuotationComposerService(
    access as unknown as WorkspaceAccessService,
    commercial as unknown as CommercialService,
    definitions as unknown as PreProjectDefinitionService,
    prices as unknown as CatalogSellingPriceService,
    events as unknown as CrmEventsService,
  );
  return { service, client, access, commercial, definitions, prices, events };
}

describe("QuotationComposerService command safety", () => {
  it("replays an exact create request before reading mutable quotation state", async () => {
    const proposal = { rooms: [] };
    const requestHash = canonicalHash({
      caseId,
      quoteId,
      revision: 4,
      mode: "assistant",
      intent: "Prepare catalog choices",
      proposal,
    });
    const query = vi.fn(async (sql: string) =>
      sql.includes("quotation_proposal_commands")
        ? {
            rowCount: 1,
            rows: [{ action: "create", requestHash, responseBody: { run: { id: runId } } }],
          }
        : { rowCount: 1, rows: [] },
    );
    const { service, commercial, definitions, events } = setup(query);
    await expect(
      service.create(actor, workspaceId, caseId, {
        requestId,
        quoteId,
        revision: 4,
        mode: "assistant",
        intent: "Prepare catalog choices",
        proposal,
      }),
    ).resolves.toEqual({ run: { id: runId }, replayed: true });
    expect(commercial.load).not.toHaveBeenCalled();
    expect(definitions.currentConfirmation).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it("rejects request-ID reuse with different information", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("quotation_proposal_commands")
        ? {
            rowCount: 1,
            rows: [{ action: "create", requestHash: "f".repeat(64), responseBody: {} }],
          }
        : { rowCount: 1, rows: [] },
    );
    const { service } = setup(query);
    await expect(
      service.create(actor, workspaceId, caseId, {
        requestId,
        quoteId,
        revision: 4,
        mode: "assistant",
        intent: "Prepare catalog choices",
        proposal: { rooms: [] },
      }),
    ).rejects.toThrow(/already used/);
  });

  it("replays an applied command after the proposal has become terminal", async () => {
    const selectedItemIds = [itemId];
    const requestHash = canonicalHash({ runId, revision: 4, selectedItemIds });
    const query = vi.fn(async (sql: string) =>
      sql.includes("quotation_proposal_commands")
        ? {
            rowCount: 1,
            rows: [{ action: "apply", requestHash, responseBody: { runId, status: "applied", revision: 5 } }],
          }
        : { rowCount: 1, rows: [] },
    );
    const { service, commercial, events } = setup(query);
    await expect(
      service.apply(actor, workspaceId, caseId, runId, {
        requestId,
        revision: 4,
        selectedItemIds,
      }),
    ).resolves.toEqual({ runId, status: "applied", revision: 5, replayed: true });
    expect(commercial.load).not.toHaveBeenCalled();
    expect(commercial.persist).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it("rejects a stale commercial revision without applying any item", async () => {
    const proposal = emptyProposal();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("quotation_proposal_commands")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM quotation_proposal_runs"))
        return {
          rowCount: 1,
          rows: [{
            id: runId,
            quoteId,
            mode: "assistant",
            status: "proposed",
            commercialRevision: 4,
            quoteDraftHash: "a".repeat(64),
            definitionBaselineId: "923e4567-e89b-42d3-a456-426614174000",
            definitionSnapshotHash: "b".repeat(64),
            definitionSourceHash: "c".repeat(64),
            proposalHash: canonicalHash(proposal),
            proposal,
            createdAt: new Date(),
            createdBy: "Composer User",
            appliedAt: null,
            appliedBy: null,
            appliedRevision: null,
            dismissedAt: null,
            dismissedBy: null,
          }],
        };
      return { rowCount: 1, rows: [] };
    });
    const { service, commercial, definitions, events } = setup(query);
    commercial.load.mockResolvedValue({ revision: 5, quotes: [quote()] });
    await expect(
      service.apply(actor, workspaceId, caseId, runId, {
        requestId,
        revision: 4,
        selectedItemIds: [itemId],
      }),
    ).rejects.toThrow(/changed after this proposal/);
    expect(definitions.currentConfirmation).not.toHaveBeenCalled();
    expect(commercial.persist).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it("requires a current confirmed Definition Baseline before generating", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("quotation_proposal_commands")
        ? { rowCount: 0, rows: [] }
        : { rowCount: 1, rows: [] },
    );
    const { service, commercial, definitions, events } = setup(query);
    commercial.load.mockResolvedValue({ revision: 4, quotes: [quote()] });
    definitions.currentConfirmation.mockResolvedValue({
      sourceHash: "c".repeat(64),
      readyToPublish: true,
      confirmed: false,
      latest: null,
    });
    await expect(
      service.create(actor, workspaceId, caseId, {
        requestId,
        quoteId,
        revision: 4,
        mode: "scope",
      }),
    ).rejects.toThrow(/Confirm the current requirements/);
    expect(events.record).not.toHaveBeenCalled();
  });

  it("rejects assistant citations outside the authorized definition snapshot", () => {
    const { service } = setup(vi.fn());
    const snapshot = {
      schemaVersion: 1 as const,
      caseId,
      brief: { version: 1 },
      rooms: [],
      items: [],
    };
    expect(() =>
      (service as unknown as {
        assistantSeeds(value: unknown, snapshot: unknown, sources: Set<string>): unknown;
      }).assistantSeeds(
        {
          rooms: [{
            name: "Kitchen",
            sourceIds: [],
            items: [{ work: { id: workId, version: 1 }, sourceIds: ["outside-source"] }],
          }],
        },
        snapshot,
        new Set([caseId, "prompt"]),
      ),
    ).toThrow(/unavailable source/);
  });

  it("does not ground a sellable suggestion only in excluded scope", () => {
    const { service } = setup(vi.fn());
    const excludedId = "a23e4567-e89b-42d3-a456-426614174000";
    const snapshot = {
      schemaVersion: 1 as const,
      caseId,
      brief: { version: 1 },
      rooms: [],
      items: [{
        id: excludedId,
        version: 1,
        title: "Excluded feature",
        roomId: null,
        roomName: null,
        category: "other",
        priority: "normal",
        scopeStatus: "excluded",
        reviewStatus: "reviewed",
        source: "client",
        quantity: 1,
        unit: "nos",
        requirement: "Do not include",
        document: null,
        avoid: "",
        referenceUrl: "",
        catalog: [],
        evidenceFiles: [],
        specification: null,
      }],
    };
    expect(() =>
      (service as unknown as {
        assistantSeeds(value: unknown, snapshot: unknown, sources: Set<string>): unknown;
      }).assistantSeeds(
        {
          rooms: [{
            name: "General",
            sourceIds: [],
            items: [{ work: { id: workId, version: 1 }, sourceIds: [excludedId] }],
          }],
        },
        snapshot,
        new Set([caseId, "brief", "prompt", excludedId]),
      ),
    ).toThrow(/grounded in included scope/);
  });

  it("invalidates a proposal when its deterministic selling-price basis changes", async () => {
    const oldPrice: CatalogPriceSnapshot = {
      status: "resolved",
      source: "catalog",
      mode: "fixed",
      catalogId,
      work: { id: workId, version: 1 },
      quantity: 1,
      currency: "AED",
      pricingDate: "2026-09-15",
      taxRate: 5,
      resolvedAt: "2026-09-15T00:00:00.000Z",
      rateCard: {
        id: "rate-1",
        version: 1,
        amount: 100,
        baseUnitRate: 100,
        appliedUnitRate: 100,
        effectiveFrom: "2026-01-01",
        taxIncluded: false,
        costIncludes: "all",
      },
    };
    const line: QuoteLine = {
      id: "line-1",
      room: "Kitchen",
      title: "Cabinetry",
      specification: "",
      material: "",
      finish: "",
      quantity: 1,
      unit: "nos",
      unitCost: 0,
      rate: 100,
      catalogLinks: [{
        role: "work",
        recordId: workId,
        version: 1,
        snapshot: { id: workId, name: "Cabinetry", code: "CAB", kind: "work", version: 1, catalogId },
      }],
      catalogPrice: oldPrice,
    };
    const item: QuotationProposalItem = {
      id: itemId,
      roomId: "a23e4567-e89b-42d3-a456-426614174000",
      roomName: "Kitchen",
      line,
      sourceIds: [caseId],
      reason: "Source",
      status: "ready",
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("SELECT r.id,r.name"))
        return {
          rowCount: 1,
          rows: [{ id: workId, name: "Cabinetry", code: "CAB", kind: "work", version: 1, catalogId, commerce: { pricingMode: "fixed" } }],
        };
      if (sql.includes("WITH RECURSIVE")) return { rowCount: 1, rows: [{ root: workId, id: workId }] };
      return { rowCount: 0, rows: [] };
    });
    const { service, client, prices } = setup(query);
    prices.resolve.mockResolvedValue({
      status: "resolved",
      code: "resolved",
      message: "Resolved",
      snapshot: {
        ...oldPrice,
        resolvedAt: "2026-09-15T01:00:00.000Z",
        rateCard: { ...oldPrice.rateCard!, amount: 120, baseUnitRate: 120, appliedUnitRate: 120 },
      },
    });
    await expect(
      (service as unknown as {
        revalidateProposal(client: PoolClient, workspace: string, quote: Quote, items: QuotationProposalItem[], date: string): Promise<unknown>;
      }).revalidateProposal(client, workspaceId, quote(), [item], "2026-09-15"),
    ).rejects.toThrow(/selling-price basis/);
  });
});
