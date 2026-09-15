import { describe, expect, it } from "vitest";
import {
  clientSafeSpecification,
  definitionIssues,
  definitionSnapshotHash,
  definitionSourceHash,
  type DefinitionSourceSnapshot,
} from "./pre-project-definition";

function snapshot(
  overrides: Partial<DefinitionSourceSnapshot["items"][number]> = {},
): DefinitionSourceSnapshot {
  return {
    schemaVersion: 1,
    caseId: "case-1",
    brief: { version: 2, goals: "A calm family home" },
    rooms: [{ id: "room-1", version: 1, name: "Bedroom" }],
    items: [
      {
        id: "scope-1",
        version: 3,
        title: "Wardrobe",
        roomId: "room-1",
        roomName: "Bedroom",
        category: "Joinery",
        priority: "must_have",
        scopeStatus: "included",
        reviewStatus: "reviewed",
        source: "client",
        quantity: 1,
        unit: "nos",
        requirement: "Four doors",
        document: null,
        avoid: "Gloss",
        referenceUrl: "",
        catalog: [],
        evidenceFiles: [],
        specification: {
          version: 4,
          refinedRequirement: "Four-door fitted wardrobe",
          construction: "Workshop fabricated",
          inclusions: "Installation",
          exclusions: "Loose furniture",
          assumptions: "Clear access",
          materials: [],
          dimensions: [],
          designs: [],
        },
        ...overrides,
      },
    ],
  };
}

describe("definition baseline domain", () => {
  it("builds a client-safe specification without catalog commerce or private asset bodies", () => {
    const result = clientSafeSpecification(
      4,
      {
        refinedRequirement: "Wardrobe",
        construction: "Plywood",
        inclusions: "Install",
        exclusions: "Electrical",
        assumptions: "Clear site",
        materials: [
          {
            id: "material-1",
            application: "Shutter",
            materialId: "catalog-material",
            productName: "Oak",
            productCode: "OAK-1",
            finishCode: "MATT-2",
            status: "selected",
            selectedBy: "Client",
            selectedAt: "2026-09-15T10:00:00.000Z",
            evidence: "Email confirmation",
            catalog: {
              material: {
                id: "catalog-material",
                version: 3,
                name: "Oak",
                code: "OAK-1",
                catalogId: "catalog-1",
                commerce: { purchaseCost: 100, sellingPrice: 150 },
              },
            },
            assets: [{ objectKey: "private/path" }],
          },
        ],
        dimensions: [],
      },
      [
        {
          versionId: "design-version-1",
          designId: "design-1",
          number: 1,
          title: "Wardrobe elevation",
          documentType: "2D",
          status: "approved",
          usage: "2d",
          sheet: "A1",
          fileName: "wardrobe.pdf",
          mimeType: "application/pdf",
          sha256: "a".repeat(64),
          objectKey: "private/design/path",
        },
      ],
    );

    expect(result.materials[0]).not.toHaveProperty("assets");
    expect(JSON.stringify(result)).not.toContain("purchaseCost");
    expect(JSON.stringify(result)).not.toContain("objectKey");
    expect(result.designs[0]).toMatchObject({
      versionId: "design-version-1",
      status: "approved",
      sha256: "a".repeat(64),
    });
  });

  it("requires decided reviewed included scope and its agreed specification", () => {
    expect(definitionIssues({ ...snapshot(), items: [] }).map((issue) => issue.code)).toEqual([
      "ADD_INCLUDED_SCOPE",
    ]);
    expect(
      definitionIssues(
        snapshot({
          scopeStatus: "undecided",
          reviewStatus: "captured",
          specification: null,
        }),
      ).map((issue) => issue.code),
    ).toEqual(["ADD_INCLUDED_SCOPE", "DECIDE_SCOPE"]);
    expect(
      definitionIssues(
        snapshot({ reviewStatus: "captured", specification: null }),
      ).map((issue) => issue.code),
    ).toEqual(["REVIEW_REQUIREMENT", "CREATE_SPECIFICATION"]);
  });

  it("rejects blank agreed wording and unresolved material changes", () => {
    const value = snapshot();
    value.items[0].specification!.refinedRequirement = "";
    value.items[0].specification!.materials = [{ status: "change_requested" }];
    expect(definitionIssues(value).map((issue) => issue.code)).toEqual([
      "COMPLETE_REFINED_REQUIREMENT",
      "RESOLVE_MATERIAL_CHANGE",
    ]);
  });

  it("produces stable source and publication hashes while keeping them distinct", () => {
    const value = snapshot();
    const sourceHash = definitionSourceHash(value);
    expect(sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(definitionSourceHash(structuredClone(value))).toBe(sourceHash);
    expect(definitionSnapshotHash(value, { message: "Please confirm" })).not.toBe(
      definitionSnapshotHash(value, { message: "Updated message" }),
    );
  });

  it("changes the source hash for rich requirement or design-status changes", () => {
    const value = snapshot();
    value.items[0].document = {
      version: 1,
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Four doors" }] }],
      },
    };
    value.items[0].specification!.designs = [
      { versionId: "design-version-1", status: "client_review" },
    ];
    const original = definitionSourceHash(value);
    const reformatted = structuredClone(value);
    const content = reformatted.items[0].document!.content as {
      content: Array<{ content: Array<Record<string, unknown>> }>;
    };
    content.content[0].content[0].marks = [{ type: "bold" }];
    const approved = structuredClone(value);
    approved.items[0].specification!.designs[0].status = "approved";

    expect(definitionSourceHash(reformatted)).not.toBe(original);
    expect(definitionSourceHash(approved)).not.toBe(original);
  });
});
