import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { freezeHash } from "../commercial/commercial.domain";
import type { CommercialData, Quote } from "../commercial/commercial.types";
import { emptyProject } from "./execution.domain";
import { releaseDeliveryProject } from "./project-release";

const now = "2026-09-15T10:00:00.000Z";

function fixture(): CommercialData {
  const quote: Quote = {
    id: "quote-1",
    number: 7,
    kind: "quotation",
    status: "accepted",
    title: "Villa fit-out",
    currency: "AED",
    validUntil: "2026-10-15",
    discount: 0,
    taxRate: 5,
    terms: "Signed terms",
    exclusions: "Loose furniture",
    requestIds: [],
    paymentTerms: [],
    createdAt: now,
    total: 1312.5,
    lines: [
      {
        id: "quote-line-1",
        scopeId: "scope-1",
        scopeVersion: 4,
        specificationVersion: 3,
        room: "Primary bedroom",
        title: "Wardrobe",
        specification: "2400 mm high, soft-close hardware",
        material: "Legacy material text",
        finish: "Natural oak",
        quantity: 2,
        unit: "nos",
        unitCost: 300,
        rate: 625,
        variant: "Premium",
        pricingMode: "materials",
        photo: "data:image/webp;base64,cHJpdmF0ZQ==",
        materialRows: [
          {
            id: "veneer",
            name: "Oak veneer",
            type: "material",
            specification: "Quarter-cut A grade",
            quantity: 5,
            unit: "m2",
            rate: 125,
            suppliedByClient: false,
          },
        ],
        customMaterials: [
          {
            id: "handle",
            name: "Client handle",
            code: "H-12",
            brand: "Sample Brand",
            specification: "Brushed brass",
            suppliedByClient: true,
          },
        ],
        catalogLinks: [
          {
            role: "room",
            recordId: "catalog-record-1",
            version: 6,
            snapshot: {
              id: "catalog-record-1",
              name: "Primary wardrobe",
              code: "WR-01",
              kind: "product",
              version: 6,
              catalogId: "catalog-1",
              catalogName: "Joinery",
              configuration: { doors: 4, finish: "oak" },
            },
          },
        ],
      },
    ],
  };
  quote.hash = freezeHash(quote);
  return {
    revision: 1,
    quotes: [quote],
    requests: [],
    agreement: {
      quoteId: quote.id,
      reference: "AGR-1",
      terms: "Signed terms",
      evidence: "Signed contract SIG-1",
      status: "executed",
      executedAt: now,
      executedBy: "Client",
    },
    payments: [],
    audit: [],
    ownerReview: {
      id: "review-1",
      quoteId: quote.id,
      quoteHash: quote.hash,
      status: "approved",
      commission: 0,
      checklist: {
        agreement: true,
        boq: true,
        documents: true,
        margin: true,
        materials: true,
        payment: true,
      },
      submissionNote: "Ready",
      submittedAt: now,
      submittedBy: "Sales",
      submittedById: "sales-user",
      decidedAt: now,
      decidedBy: "Owner",
      decidedById: "owner-user",
    },
    dealFile: {
      id: "deal-1",
      reference: "DF-2026-CASE",
      revision: 1,
      ownerReviewId: "review-1",
      quoteId: quote.id,
      quoteNumber: quote.number,
      quoteHash: quote.hash,
      agreementReference: "AGR-1",
      paymentIds: [],
      value: quote.total,
      cost: 600,
      margin: 650,
      commission: 0,
      status: "active",
      approvedAt: now,
      approvedBy: "Owner",
    },
    materialApprovals: [
      {
        id: "approval-1",
        quoteId: quote.id,
        lineId: "quote-line-1",
        materialRowId: "veneer",
        revision: 1,
        room: "Primary bedroom",
        item: "Wardrobe",
        name: "Oak veneer",
        code: "",
        brand: "",
        specification: "Quarter-cut A grade",
        note: "Approved sample",
        status: "approved",
        decidedAt: now,
        decidedBy: "Client",
      },
    ],
    release: {
      id: "release-1",
      at: now,
      by: "Owner",
      note: "Release to delivery",
      quoteId: quote.id,
      dealFileId: "deal-1",
    },
  };
}

function database(options: { existing?: ReturnType<typeof emptyProject>; scopeVersion?: number } = {}) {
  let stored: ReturnType<typeof emptyProject> | undefined;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (
      sql.includes("FROM pre_project_brief_entries e WHERE") ||
      sql.includes("FROM pre_project_brief_entries entry")
    )
      return {
        rowCount: 1,
        rows: [
          {
            version: options.scopeVersion ?? 4,
            scope_status: "included",
            archived_at: null,
            specification_version: 3,
          },
        ],
      };
    if (sql.includes('SELECT version.id AS "designVersionId"'))
      return {
        rowCount: 1,
        rows: [
          {
            designVersionId: "design-version-1",
            designId: "design-1",
            title: "Wardrobe elevation",
            documentType: "drawing",
            revision: 2,
            approvedAt: now,
          },
        ],
      };
    if (sql.includes("FROM pre_project_item_design_refs"))
      return { rowCount: 1, rows: [{ total: 1, approved: 1 }] };
    if (sql.includes("INSERT INTO delivery_projects"))
      return {
        rowCount: 1,
        rows: [
          {
            id: "project-1",
            name: "Villa fit-out",
            status: "active",
            caseId: "case-1",
          },
        ],
      };
    if (sql.startsWith("SELECT content FROM project_execution"))
      return {
        rowCount: options.existing ? 1 : 0,
        rows: options.existing ? [{ content: options.existing }] : [],
      };
    if (sql.includes("FROM project_workflow_templates"))
      return { rowCount: 0, rows: [] };
    if (sql.startsWith("INSERT INTO project_execution")) {
      stored = JSON.parse(String(values?.[3]));
      return { rowCount: 1, rows: [] };
    }
    if (sql.includes("INSERT INTO crm_project_links"))
      return { rowCount: 1, rows: [{ id: "crm-link-1" }] };
    return { rowCount: 1, rows: [] };
  });
  return {
    client: { query } as unknown as PoolClient,
    query,
    stored: () => stored,
  };
}

describe("commercial project release", () => {
  it("freezes accepted scope lineage and client-safe pricing into execution", async () => {
    const data = fixture(), db = database();

    await releaseDeliveryProject(db.client, "workspace-1", "case-1", "user-1", data);

    const scope = db.stored()?.scope;
    expect(scope).toMatchObject({
      quoteId: "quote-1",
      quoteHash: data.dealFile?.quoteHash,
      quoteNumber: 7,
      dealFileId: "deal-1",
      dealFileReference: "DF-2026-CASE",
      releaseId: "release-1",
      releasedAt: now,
      currency: "AED",
      value: 1312.5,
    });
    expect(scope?.lines[0]).toMatchObject({
      id: "quote-line-1",
      sourceScopeId: "scope-1",
      sourceScopeVersion: 4,
      sourceSpecificationVersion: 3,
      specification: "2400 mm high, soft-close hardware",
      finish: "Natural oak",
      rate: 625,
      lineTotal: 1250,
      variant: "Premium",
      pricingMode: "materials",
      materialRows: [{ id: "veneer", rate: 125 }],
      customMaterials: [{ id: "handle", code: "H-12" }],
      catalogSelections: [
        {
          recordId: "catalog-record-1",
          version: 6,
          snapshot: { version: 6, configuration: { doors: 4, finish: "oak" } },
        },
      ],
    });
    expect(scope?.lines[0]).not.toHaveProperty("unitCost");
    expect(scope?.lines[0]).not.toHaveProperty("photo");
    expect(scope?.lines[0]).not.toHaveProperty("catalogLinks");
    expect(db.stored()?.workflow).toMatchObject({
      currentStageKey: "planning",
      template: { code: "standard_delivery", source: "built_in", version: 0 },
    });
    expect(db.stored()?.workPackages).toEqual([
      expect.objectContaining({
        scopeLineIds: ["quote-line-1"],
        title: "Wardrobe",
        status: "planning",
        deliveryRoute: "mixed",
      }),
    ]);
    expect(db.stored()?.initiation).toMatchObject({
      status: "not_started",
      commercial: {
        quoteId: "quote-1",
        quoteHash: data.dealFile?.quoteHash,
        quoteNumber: 7,
        dealFileReference: "DF-2026-CASE",
        agreementReference: "AGR-1",
        currency: "AED",
        value: 1312.5,
      },
    });
    expect(db.stored()?.designBaseline).toMatchObject({
      links: [
        expect.objectContaining({
          scopeLineId: "quote-line-1",
          designVersionId: "design-version-1",
          revision: 2,
        }),
      ],
    });
    expect(db.stored()?.documents).toContainEqual(
      expect.objectContaining({
        title: "Wardrobe elevation · Rev 2",
        status: "approved",
        sourceDesignVersionId: "design-version-1",
        scopeLineIds: ["quote-line-1"],
      }),
    );
  });

  it("rejects accepted-price drift against the approved Deal File", async () => {
    const data = fixture(), db = database();
    data.quotes[0].lines[0].rate = 700;

    await expect(
      releaseDeliveryProject(db.client, "workspace-1", "case-1", "user-1", data),
    ).rejects.toThrow("no longer matches the approved Deal File");
    expect(db.query).not.toHaveBeenCalled();
  });

  it("rejects stale preparation versions before creating a project", async () => {
    const db = database({ scopeVersion: 5 });

    await expect(
      releaseDeliveryProject(db.client, "workspace-1", "case-1", "user-1", fixture()),
    ).rejects.toThrow("Preparation changed for Wardrobe");
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO delivery_projects"))).toBe(false);
  });

  it("does not replace an already frozen execution baseline on a safe retry", async () => {
    const existing = emptyProject();
    existing.scope = {
      quoteId: "quote-1",
      quoteHash: "original-hash",
      quoteNumber: 7,
      currency: "AED",
      value: 1000,
      lines: [],
    };
    const db = database({ existing }), data = fixture();

    await releaseDeliveryProject(db.client, "workspace-1", "case-1", "user-1", data);

    expect(existing.scope.quoteHash).toBe("original-hash");
    expect(db.stored()?.initiation).toMatchObject({
      status: "not_started",
      commercial: { quoteId: "quote-1", quoteHash: "original-hash" },
    });
  });

  it("backfills only missing work packages on a safe retry of a historical release", async () => {
    const existing = emptyProject();
    existing.scope = {
      quoteId: "quote-1",
      quoteHash: "original-hash",
      quoteNumber: 7,
      currency: "AED",
      value: 1000,
      lines: [{
        id: "quote-line-1",
        title: "Wardrobe",
        room: "Primary bedroom",
        material: "Oak veneer",
        quantity: 2,
        unit: "nos",
      }],
    };
    const db = database({ existing });

    await releaseDeliveryProject(db.client, "workspace-1", "case-1", "user-1", fixture());

    expect(db.stored()?.scope?.quoteHash).toBe("original-hash");
    expect(db.stored()?.workPackages).toEqual([
      expect.objectContaining({ scopeLineIds: ["quote-line-1"], title: "Wardrobe" }),
    ]);
  });
});
