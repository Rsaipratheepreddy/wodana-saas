import { describe, expect, it } from "vitest";
import {
  bandProblem, categoriesProblem, changedSinceHandoff, DEFAULT_FINISH_CATEGORIES, editorSlotsProblem, logStatus, markerProblem, markerValue, originOf, originProblem, outsourcedFrom,
  readCategories, signatureProblem, signaturesMissing, specificationProblem,
} from "./finishes.domain";
import { versionProblem } from "./design-ledger.domain";

describe("finish categories (PLM-156, PLM-148)", () => {
  it("keeps the firm's list in its order and drops malformed rows from an old or hand-edited setting", () => {
    expect(readCategories([{ key: "sanitary_ware", label: " Sanitary ware ", clientSignature: true }, { key: "Bad Key", label: "x" }, { key: "lighting", label: "" },
      { key: "sanitary_ware", label: "Again" }, { key: "lighting", label: "Lighting" }])).toEqual([
      { key: "sanitary_ware", label: "Sanitary ware", clientSignature: true }, { key: "lighting", label: "Lighting", clientSignature: false }]);
    expect(readCategories(null)).toEqual([]);
    expect(DEFAULT_FINISH_CATEGORIES.every((category) => !category.clientSignature)).toBe(true);
  });

  it("refuses a list it can't keep, in words", () => {
    expect(categoriesProblem("x")).toBe("Send the categories as a list");
    expect(categoriesProblem([{ key: "Bad", label: "Bad" }])).toMatch(/lower-case/);
    expect(categoriesProblem([{ key: "a", label: "" }])).toMatch(/Name each category/);
    expect(categoriesProblem([{ key: "a", label: "A" }, { key: "a", label: "B" }])).toBe("a is in the list twice");
    expect(categoriesProblem([{ key: "a", label: "Tiles" }, { key: "b", label: "tiles" }])).toBe("tiles is in the list twice");
    expect(categoriesProblem([{ key: "a", label: "A", clientSignature: "yes" }])).toMatch(/yes or no/);
    expect(categoriesProblem([{ key: "whitegoods", label: "Whitegoods", clientSignature: true }])).toBeNull();
  });

  it("names the design team parts that edit the material column", () => {
    expect(editorSlotsProblem(["lead_designer", "junior_designer", "sales_admin"])).toBeNull();
    expect(editorSlotsProblem(["qs"])).toBe("Choose parts of the design team");
  });
});

describe("the material log (PLM-157)", () => {
  it("reads Approved / Not approved / In process from the client's decision and the outsourced sign-off", () => {
    expect(logStatus(null)).toBe("in_process");
    expect(logStatus({ status: "proposed" })).toBe("in_process");
    expect(logStatus({ status: "confirmed" })).toBe("approved");
    expect(logStatus({ status: "declined" })).toBe("not_approved");
    expect(logStatus({ status: "confirmed", outsourced: true, signOff: "pending" })).toBe("in_process");
    expect(logStatus({ status: "confirmed", outsourced: true, signOff: "approved" })).toBe("approved");
    expect(logStatus({ status: "confirmed", outsourced: true, signOff: "rejected" })).toBe("not_approved");
    expect(logStatus({ status: "proposed", outsourced: true, signOff: "returned" })).toBe("not_approved");
  });

  it("says where a material comes from, and reads an old version (only the outsourced flag) sensibly", () => {
    expect(originOf({ origin: "brand", outsourced: false })).toBe("brand");
    expect(originOf({ origin: null, outsourced: true })).toBe("local_supplier");
    expect(originOf({ origin: null, outsourced: false })).toBeNull();
    expect(outsourcedFrom({ origin: "local_supplier" })).toBe(true);
    expect(outsourcedFrom({ origin: "own_stock", outsourced: undefined })).toBe(false);
    expect(outsourcedFrom({ outsourced: true })).toBe(true);
    expect(originProblem({ origin: "own_stock", outsourced: true })).toMatch(/local supplier/);
    expect(originProblem({ origin: "shop" })).toMatch(/comes from/);
    expect(originProblem({ origin: "local_supplier", outsourced: true })).toBeNull();
  });

  it("checks the origin with the rest of a ledger version", () => {
    const base = { title: "Calacatta marble", source: "showroom", saidAt: "2026-10-10T10:00:00.000Z" };
    expect(versionProblem({ ...base, origin: "brand" }, new Date("2026-10-13T00:00:00Z"))).toBeNull();
    expect(versionProblem({ ...base, origin: "brand", outsourced: true }, new Date("2026-10-13T00:00:00Z"))).toMatch(/local supplier/);
  });
});

describe("the designer's specification for QS (PLM-146)", () => {
  it("places a marker inside the snapshot with a label", () => {
    expect(markerProblem({ markerX: 50, markerY: 20.5, label: "Calacatta, honed" })).toBeNull();
    expect(markerProblem({ markerX: 101, markerY: 2, label: "x" })).toBe("Place the marker on the picture");
    expect(markerProblem({ markerX: "5", markerY: 2, label: "x" })).toBe("Place the marker on the picture");
    expect(markerProblem({ markerX: 5, markerY: 2, label: "  " })).toMatch(/marble type/);
    expect(markerValue(33.3333)).toBe("33.33");
  });

  it("lists what changed since the finishes went to QS: new, changed and removed", () => {
    const sent = [{ entryId: "a", versionId: "a1", title: "Marble" }, { entryId: "b", versionId: "b1", title: "Veneer" }, { entryId: "c", versionId: "c1", title: "Brass trim" }];
    expect(changedSinceHandoff([{ id: "a", title: "Marble", versionId: "a1" }, { id: "b", title: "Veneer", versionId: "b2" }, { id: "d", title: "Tap", versionId: "d1" }], sent))
      .toEqual(["Veneer", "Tap", "Brass trim"]);
    expect(changedSinceHandoff([{ id: "a", title: "Marble", versionId: "a1" }], sent.slice(0, 1))).toEqual([]);
  });

  it("is final once the samples are approved and the finishes went to QS unchanged; a job without a samples step needs only the hand-off", () => {
    const final = { samplesStep: true, samplesApproved: true, sentNumber: 1, changedSince: [], finishes: 3 };
    expect(specificationProblem(final)).toBeNull();
    expect(specificationProblem({ ...final, samplesApproved: false })).toMatch(/samples aren't approved/);
    expect(specificationProblem({ ...final, sentNumber: null })).toMatch(/hasn't sent the finishes/);
    expect(specificationProblem({ ...final, finishes: 0 })).toMatch(/no finishes/);
    expect(specificationProblem({ ...final, changedSince: ["Veneer", "Tap", "Marble", "Grout"] })).toBe("Veneer, Tap, Marble and 1 more changed after the finishes went to QS. The designer sends them to QS again.");
    expect(specificationProblem({ ...final, samplesStep: false, samplesApproved: false })).toBeNull();
  });
});

describe("the client's signed samples before procurement (PLM-148)", () => {
  const categories = [{ key: "sanitary_ware", label: "Sanitary ware", clientSignature: true }, { key: "lighting", label: "Lighting", clientSignature: false }];

  it("needs a signature only in the marked categories, on the version procurement uses", () => {
    expect(signaturesMissing([
      { title: "Basin", categoryKey: "sanitary_ware", requiredVersionId: "v2", signedVersionIds: ["v1"] },
      { title: "WC", categoryKey: "sanitary_ware", requiredVersionId: "w1", signedVersionIds: ["w1"] },
      { title: "Pendant", categoryKey: "lighting", requiredVersionId: "p1", signedVersionIds: [] },
      { title: "Uncategorised", categoryKey: null, requiredVersionId: "u1", signedVersionIds: [] },
    ], categories)).toEqual(["Basin"]);
    expect(signaturesMissing([{ title: "Basin", categoryKey: "sanitary_ware", requiredVersionId: "v1", signedVersionIds: [] }], categories.map((category) => ({ ...category, clientSignature: false })))).toEqual([]);
  });

  it("records a signature with the day, who signed and the photo", () => {
    expect(signatureProblem({ signedOn: "2026-10-12", signer: "Aisha", assetId: "x" }, "2026-10-13")).toBeNull();
    expect(signatureProblem({ signedOn: "2026-10-14", signer: "Aisha", assetId: "x" }, "2026-10-13")).toMatch(/future/);
    expect(signatureProblem({ signedOn: "12/10/2026", signer: "Aisha", assetId: "x" }, "2026-10-13")).toMatch(/day the client signed/);
    expect(signatureProblem({ signedOn: "2026-10-12", signer: " ", assetId: "x" }, "2026-10-13")).toBe("Say who signed");
    expect(signatureProblem({ signedOn: "2026-10-12", signer: "Aisha", assetId: null }, "2026-10-13")).toMatch(/photo/);
  });
});

describe("sample price bands (PLM-157)", () => {
  it("takes a label and money amounts that make a range, either end open", () => {
    expect(bandProblem({ label: "Premium", minAmount: "250", maxAmount: "600.50" })).toBeNull();
    expect(bandProblem({ label: "Entry", minAmount: null, maxAmount: "100" })).toBeNull();
    expect(bandProblem({ label: "Mid" })).toBeNull();
    expect(bandProblem({ label: "", minAmount: "1" })).toMatch(/Name the price band/);
    expect(bandProblem({ label: "Odd", minAmount: "1.234" })).toMatch(/two decimals/);
    expect(bandProblem({ label: "Odd", minAmount: 100 })).toMatch(/two decimals/);
    expect(bandProblem({ label: "Odd", minAmount: "500", maxAmount: "100" })).toMatch(/at least the lower/);
  });
});
