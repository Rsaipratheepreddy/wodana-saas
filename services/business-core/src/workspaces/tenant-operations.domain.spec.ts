import { describe, expect, it } from "vitest";
import {
  canonicalHash,
  deriveBillingAccessPolicy,
  effectiveEntitledModules,
  planAccountContract,
  planBillingAllocation,
  planCommercialEntitlement,
  normalizeEntitledModules,
  operationPlan,
  tenantModuleForPermission,
  validateBillingDocumentEvent,
  validateCollectionState,
} from "./tenant-operations.domain";
import { inspectObject } from "./file-safety";

const empty = { members: 1, pendingInvitations: 0, projects: 0, knownFileBytes: 0, knownFileCount: 0 };

describe("tenant operations contract", () => {
  it("intersects sold modules with role-granted modules while preserving legacy compatibility", () => {
    const granted = ["workspace", "crm", "projects"] as const;
    expect(effectiveEntitledModules(granted, null)).toEqual(granted);
    expect(effectiveEntitledModules(granted, { status: "active", modules: ["crm"] })).toEqual(["workspace", "crm"]);
    expect(effectiveEntitledModules(granted, { status: "suspended", modules: ["crm", "projects"] })).toEqual(["workspace"]);
    expect(normalizeEntitledModules(["projects", "crm", "projects"])).toEqual(["workspace", "crm", "projects"]);
  });

  it("maps permissions to one commercial module boundary", () => {
    expect(tenantModuleForPermission("crm.leads.view")).toBe("crm");
    expect(tenantModuleForPermission("commercial.quote.edit")).toBe("pre-project");
    expect(tenantModuleForPermission("catalog.cost.view")).toBe("pre-project");
    expect(tenantModuleForPermission("projects.report")).toBe("projects");
    expect(tenantModuleForPermission("hrms.self")).toBe("hrms");
    expect(tenantModuleForPermission("workspace.settings.manage")).toBe("workspace");
  });

  it("produces deterministic operation requests and blocks unsafe clone or erasure plans", () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    expect(operationPlan({ type: "clone", source: empty, target: empty, legalHold: false,
      exportBeforeErasure: true, hasCompletedExport: false })).toMatchObject({ executable: true, blockers: [] });
    expect(operationPlan({ type: "clone", source: empty, target: { ...empty, projects: 1 }, legalHold: false,
      exportBeforeErasure: true, hasCompletedExport: false })).toMatchObject({ executable: false });
    const erasure = operationPlan({ type: "erasure", source: empty, legalHold: true,
      exportBeforeErasure: true, hasCompletedExport: false });
    expect(erasure.executable).toBe(false);
    expect(erasure.blockers).toEqual(expect.arrayContaining([
      "A legal hold prevents erasure.",
      "Complete and verify a tenant export before requesting erasure.",
    ]));
  });

  it("blocks the anti-malware test signature and executable headers before storage", () => {
    expect(inspectObject(Buffer.from("plain project note")).status).toBe("baseline_clean");
    expect(inspectObject(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")).status).toBe("quarantined");
    expect(inspectObject(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toMatchObject({ status: "quarantined", reason: "executable_content" });
  });
});

describe("planCommercialEntitlement", () => {
  const base = {
    requestedLimits: {},
    contract: { seatLimit: 10, projectLimit: 50 },
    status: "active" as const,
    now: new Date("2026-09-18T08:00:00.000Z"),
  };

  it("intersects an organization allocation with versioned plan modules", () => {
    expect(planCommercialEntitlement({
      ...base,
      requestedModules: ["crm"],
      planConfiguration: { modules: ["workspace", "crm", "projects"] },
    })).toMatchObject({
      soldModules: ["workspace", "crm", "projects"],
      allocationModules: ["workspace", "crm"],
      customOverride: false,
    });
  });

  it("records legacy plans without module metadata as an explicit override", () => {
    expect(planCommercialEntitlement({
      ...base,
      requestedModules: ["crm", "projects"],
      planConfiguration: { seatLimit: 10 },
    })).toMatchObject({ soldModules: ["workspace", "crm", "projects"], customOverride: true });
  });

  it("rejects unsold modules and allocation limits above the account contract", () => {
    expect(() => planCommercialEntitlement({
      ...base,
      requestedModules: ["projects"],
      planConfiguration: { modules: ["workspace", "crm"] },
    })).toThrow("projects");
    expect(() => planCommercialEntitlement({
      ...base,
      requestedModules: ["crm"],
      requestedLimits: { seatLimit: 11 },
      planConfiguration: { modules: ["workspace", "crm"] },
    })).toThrow("account contract");
  });

  it("requires a future start for scheduled allocations and an ordered end", () => {
    expect(() => planCommercialEntitlement({
      ...base,
      status: "scheduled",
      effectiveFrom: "2026-09-18T07:59:00.000Z",
      requestedModules: ["crm"],
      planConfiguration: { modules: ["workspace", "crm"] },
    })).toThrow("future");
    expect(() => planCommercialEntitlement({
      ...base,
      effectiveFrom: "2026-09-19T08:00:00.000Z",
      effectiveUntil: "2026-09-19T07:00:00.000Z",
      requestedModules: ["crm"],
      planConfiguration: { modules: ["workspace", "crm"] },
    })).toThrow("after its start");
  });
});

describe("account billing authority", () => {
  const contract = {
    status: "contracted" as const,
    planCode: "enterprise",
    planVersion: 2,
    currency: "aed",
    billingCycle: "yearly" as const,
    recurringAmount: 120000,
    seatLimit: 25,
    projectLimit: 200,
    signedAt: "2026-09-01T00:00:00.000Z",
    termStartsAt: "2026-09-01T00:00:00.000Z",
    renewsAt: "2027-09-01T00:00:00.000Z",
    legalEntityReference: "Palm Living Interiors LLC",
    terms: { paymentDays: 30 },
    now: new Date("2026-09-18T08:00:00.000Z"),
  };

  it("normalizes versioned contract terms without claiming tax validation", () => {
    expect(planAccountContract(contract)).toMatchObject({
      currency: "AED",
      taxValidationState: "unverified",
      recurringAmount: 120000,
      seatLimit: 25,
    });
    expect(() => planAccountContract({ ...contract, status: "trial_uncontracted", signedAt: null }))
      .not.toThrow();
    expect(() => planAccountContract({ ...contract, signedAt: null })).toThrow("signed date");
    expect(() => planAccountContract({ ...contract, endsAt: "2026-08-01T00:00:00.000Z" })).toThrow("term end");
  });

  it("keeps organization allocations within the account contract and current usage", () => {
    const allocation = {
      status: "active" as const,
      allocatedAmount: 60000,
      seatLimit: 10,
      projectLimit: 80,
      contract: { recurringAmount: 120000, seatLimit: 25, projectLimit: 200 },
      allocatedElsewhere: { recurringAmount: 40000, seatLimit: 8, projectLimit: 60 },
      currentUsage: { seats: 6, projects: 20 },
      now: new Date("2026-09-18T08:00:00.000Z"),
    };
    expect(planBillingAllocation(allocation)).toMatchObject({ seatLimit: 10, projectLimit: 80 });
    expect(() => planBillingAllocation({ ...allocation, seatLimit: 5 })).toThrow("reserved seats");
    expect(() => planBillingAllocation({ ...allocation, allocatedAmount: 90000 })).toThrow("exceed");
  });

  it("distinguishes provider notifications from finance-verified receipts", () => {
    expect(validateBillingDocumentEvent({
      documentType: "receipt", status: "failed", eventType: "provider_notification",
      totalAmount: 100, balanceAmount: 100, currency: "AED",
    })).toMatchObject({ status: "failed", taxValidationState: "unverified" });
    expect(() => validateBillingDocumentEvent({
      documentType: "receipt", status: "verified", eventType: "provider_notification",
      totalAmount: 100, balanceAmount: 0, currency: "AED",
    })).toThrow("finance verification");
    expect(validateBillingDocumentEvent({
      documentType: "receipt", status: "verified", eventType: "finance_verified",
      totalAmount: 100, balanceAmount: 0, currency: "aed",
    })).toMatchObject({ status: "verified", currency: "AED", taxValidationState: "unverified" });
    expect(() => validateBillingDocumentEvent({
      documentType: "invoice", previousStatus: "paid", status: "past_due", eventType: "corrected",
      totalAmount: 100, balanceAmount: 100, currency: "AED",
    })).toThrow("Cannot move");
    expect(validateBillingDocumentEvent({
      documentType: "receipt", previousStatus: "verified", status: "refunded", eventType: "corrected",
      totalAmount: 100, balanceAmount: 100, currency: "AED",
    })).toMatchObject({ status: "refunded" });
    expect(() => validateBillingDocumentEvent({
      documentType: "receipt", status: "refunded", eventType: "corrected",
      totalAmount: 100, balanceAmount: 100, currency: "AED",
    })).toThrow("existing paid or verified");
  });

  it("validates collection amounts and review dates", () => {
    expect(validateCollectionState({ status: "past_due", overdueAmount: 2000, currency: "aed",
      effectiveAt: "2026-09-18T08:00:00.000Z", nextReviewAt: "2026-09-19T08:00:00.000Z" }))
      .toMatchObject({ status: "past_due", currency: "AED" });
    expect(() => validateCollectionState({ status: "current", overdueAmount: 1, currency: "AED" }))
      .toThrow("current account");
  });

  it("keeps trial, grace and past-due billing truth separate from access authorization", () => {
    const now = new Date("2026-09-18T08:00:00.000Z");
    expect(deriveBillingAccessPolicy({ contractStatus: "trial_uncontracted",
      trialEndsAt: "2026-09-19T08:00:00.000Z", collectionStatus: "current", now }))
      .toMatchObject({ state: "trial", effect: "unchanged", warning: false, affectedModules: [] });
    expect(deriveBillingAccessPolicy({ contractStatus: "trial_uncontracted",
      trialEndsAt: "2026-09-17T08:00:00.000Z", collectionStatus: "current", now }))
      .toMatchObject({ state: "trial_expired", effect: "unchanged", warning: true });
    expect(deriveBillingAccessPolicy({ contractStatus: "contracted", collectionStatus: "grace",
      nextReviewAt: "2026-09-20T08:00:00.000Z", now }))
      .toMatchObject({ state: "grace", effect: "unchanged", warning: true });
    expect(deriveBillingAccessPolicy({ contractStatus: "contracted", collectionStatus: "past_due", now }))
      .toMatchObject({ state: "past_due", effect: "unchanged", warning: true, affectedModules: [] });
    expect(deriveBillingAccessPolicy({ contractStatus: "contracted", collectionStatus: "current", now }))
      .toMatchObject({ state: "current", effect: "unchanged", warning: false, affectedModules: [] });
  });
});
