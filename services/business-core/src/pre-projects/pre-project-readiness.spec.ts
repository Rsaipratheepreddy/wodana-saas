import { describe, expect, it } from "vitest";
import {
  evaluatePreProjectReadiness,
  type PreProjectItemFact,
  type PreProjectReadinessFacts,
} from "./pre-project-readiness";

function readyItem(overrides: Partial<PreProjectItemFact> = {}): PreProjectItemFact {
  return {
    id: "scope-1",
    title: "Reception cabinetry",
    roomId: "room-1",
    roomName: "Reception",
    version: 3,
    scopeStatus: "included",
    reviewStatus: "reviewed",
    archivedAt: null,
    specificationVersion: 4,
    specification: { materials: [{ status: "selected" }] },
    measurement: {
      id: "measurement-1",
      version: 2,
      status: "verified",
      hasEvidence: true,
    },
    designs: [
      {
        versionId: "design-version-2",
        designId: "design-1",
        number: 2,
        latestNumber: 2,
        status: "approved",
        usage: "primary",
        blockingOpen: false,
      },
    ],
    ...overrides,
  };
}

function readyFacts(overrides: Partial<PreProjectReadinessFacts> = {}): PreProjectReadinessFacts {
  return {
    case: { id: "case-1", status: "active", phase: "design", version: 5 },
    sitePlanCount: 1,
    openObservationCount: 0,
    items: [readyItem()],
    definitionConfirmation: {
      readyToPublish: true,
      confirmed: true,
      latest: {
        id: "definition-1",
        number: 1,
        snapshotHash: "d".repeat(64),
        status: "confirmed",
        current: true,
      },
    },
    ...overrides,
  };
}

const currentReference = {
  scopeId: "scope-1",
  title: "Reception cabinetry",
  scopeVersion: 3,
  specificationVersion: 4,
};

describe("Preparation pricing readiness", () => {
  it("returns a deterministic ready contract for fully evidenced scope", () => {
    const first = evaluatePreProjectReadiness(readyFacts(), {
      scopeReferences: [currentReference],
    });
    const second = evaluatePreProjectReadiness(readyFacts(), {
      scopeReferences: [currentReference],
    });

    expect(first.ready).toBe(true);
    expect(first.summary).toEqual({
      includedItemCount: 1,
      evaluatedItemCount: 1,
      readyItemCount: 1,
      blockerCount: 0,
      warningCount: 0,
    });
    expect(first.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.stateHash).toBe(second.stateHash);
    expect(first.nextActions).toEqual([]);
  });

  it("detects stale quotation snapshots before commercial review", () => {
    const result = evaluatePreProjectReadiness(readyFacts(), {
      scopeReferences: [
        { ...currentReference, scopeVersion: 2, specificationVersion: 3 },
      ],
    });

    expect(result.ready).toBe(false);
    expect(result.blockers.map((value) => value.code)).toContain(
      "scope_version_current",
    );
    expect(result.blockers.map((value) => value.code)).toContain(
      "specification_version_current",
    );
    expect(result.nextActions).toEqual([
      {
        code: "REFRESH_QUOTATION_SCOPE",
        label: "Refresh quotation scope",
        targetType: "scope_item",
        targetId: "scope-1",
      },
    ]);
  });

  it("returns prerequisite actions without impossible dependent actions", () => {
    const item = readyItem({
      specificationVersion: null,
      specification: null,
      measurement: null,
      designs: [],
    });
    const result = evaluatePreProjectReadiness(
      readyFacts({ sitePlanCount: 0, items: [item] }),
      { scopeReferences: [{ scopeId: item.id, title: item.title, scopeVersion: 3 }] },
    );
    const actions = result.nextActions.map((value) => value.code);

    expect(result.ready).toBe(false);
    expect(actions).toEqual([
      "ADD_SITE_PLAN",
      "CREATE_SPECIFICATION",
      "RECORD_MEASUREMENT",
      "LINK_DESIGN_REVISION",
    ]);
    expect(actions).not.toContain("ADD_MEASUREMENT_EVIDENCE");
    expect(actions).not.toContain("APPROVE_DESIGN_REVISION");
  });

  it("blocks unverified evidence and approval feedback independently", () => {
    const item = readyItem({
      measurement: {
        id: "measurement-1",
        version: 2,
        status: "recheck",
        hasEvidence: false,
      },
      designs: [
        {
          ...readyItem().designs[0],
          status: "internal_review",
          blockingOpen: true,
        },
      ],
    });
    const result = evaluatePreProjectReadiness(readyFacts({ items: [item] }), {
      scopeReferences: [currentReference],
    });

    expect(result.nextActions.map((value) => value.code)).toEqual([
      "VERIFY_MEASUREMENT",
      "ADD_MEASUREMENT_EVIDENCE",
      "APPROVE_DESIGN_REVISION",
      "RESOLVE_DESIGN_FEEDBACK",
    ]);
  });

  it("keeps material, site and newer-design concerns as warnings without requiring raw-note review", () => {
    const item = readyItem({
      reviewStatus: "captured",
      specification: { materials: [{ status: "proposed" }] },
      designs: [
        { ...readyItem().designs[0], latestNumber: 3 },
      ],
    });
    const result = evaluatePreProjectReadiness(
      readyFacts({ openObservationCount: 2, items: [item] }),
      { scopeReferences: [currentReference] },
    );

    expect(result.ready).toBe(true);
    expect(result.warnings.map((value) => value.code)).toEqual([
      "open_site_observations",
      "newer_design_revision",
      "material_selection_pending",
    ]);
  });

  it("blocks inactive, empty and duplicate scope without duplicating actions", () => {
    const noScope = evaluatePreProjectReadiness(
      readyFacts({
        case: { id: "case-1", status: "on_hold", phase: "design", version: 6 },
        items: [],
      }),
    );
    expect(noScope.nextActions.map((value) => value.code)).toEqual([
      "RESUME_ENGAGEMENT",
      "ADD_INCLUDED_SCOPE",
    ]);

    const duplicate = evaluatePreProjectReadiness(readyFacts(), {
      scopeReferences: [currentReference, currentReference],
    });
    expect(duplicate.ready).toBe(false);
    expect(
      duplicate.blockers.filter(
        (value) => value.code === "duplicate_scope_reference",
      ),
    ).toHaveLength(1);
  });

  it("surfaces removed quotation scope and does not cascade irrelevant checks", () => {
    const result = evaluatePreProjectReadiness(readyFacts({ items: [] }), {
      requireIncludedScope: false,
      scopeReferences: [currentReference],
    });

    expect(result.items[0].checks.map((value) => value.code)).toEqual([
      "scope_exists",
    ]);
    expect(result.nextActions.map((value) => value.code)).toEqual([
      "REFRESH_QUOTATION_SCOPE",
    ]);
  });

  it("supports a custom-only quotation without weakening case and site gates", () => {
    const result = evaluatePreProjectReadiness(readyFacts({ items: [] }), {
      requireIncludedScope: false,
      scopeReferences: [],
    });
    expect(result.ready).toBe(true);

    const unsafe = evaluatePreProjectReadiness(
      readyFacts({
        case: { id: "case-1", status: "on_hold", phase: "design", version: 6 },
        sitePlanCount: 0,
        items: [],
      }),
      { requireIncludedScope: false, scopeReferences: [] },
    );
    expect(unsafe.nextActions.map((value) => value.code)).toEqual([
      "RESUME_ENGAGEMENT",
      "ADD_SITE_PLAN",
    ]);
  });

  it("allows a pre-payment design proposal before the site visit without relaxing the main quote", () => {
    const facts = readyFacts({ sitePlanCount: 0, items: [] });
    const design = evaluatePreProjectReadiness(facts, {
      requireIncludedScope: false, requireSitePlan: false, scopeReferences: [],
    });
    expect(design.ready).toBe(true);
    expect(design.checks.some(value => value.code === "site_plan")).toBe(false);
    const main = evaluatePreProjectReadiness(facts, {
      requireIncludedScope: false, scopeReferences: [],
    });
    expect(main.ready).toBe(false);
    expect(main.blockers.map(value => value.code)).toContain("site_plan");
  });

  it("requires a current confirmed definition and returns the correct workflow action", () => {
    const unpublished = evaluatePreProjectReadiness(
      readyFacts({
        definitionConfirmation: {
          readyToPublish: true,
          confirmed: false,
          latest: null,
        },
      }),
      { scopeReferences: [currentReference] },
    );
    expect(unpublished.ready).toBe(false);
    expect(unpublished.nextActions.map((value) => value.code)).toEqual([
      "PUBLISH_DEFINITION",
    ]);

    const changed = evaluatePreProjectReadiness(
      readyFacts({
        definitionConfirmation: {
          readyToPublish: true,
          confirmed: false,
          latest: {
            id: "definition-1",
            number: 1,
            snapshotHash: "d".repeat(64),
            status: "superseded",
            current: false,
          },
        },
      }),
      { scopeReferences: [currentReference] },
    );
    expect(changed.nextActions.map((value) => value.code)).toEqual([
      "PUBLISH_DEFINITION",
    ]);
  });
});
