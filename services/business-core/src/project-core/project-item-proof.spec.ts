import { describe, expect, it } from "vitest";
import { drawingNeed } from "./project-drawing-needs";
import { signItemDrawings } from "./project-item-decisions";
import {
  assertCanUpload, assertSignable, decimalInput, deliveryNext, drawingInput, itemDrawingState, MISSING_PROOF, proofFacts, reviewOutcome, signingBatchId,
} from "./project-item-proof";

const CASE = "6f1c2b9e-3a4d-4e5f-8a9b-0c1d2e3f4a5b";
const V1 = "11111111-1111-4111-8111-111111111111", V2 = "22222222-2222-4222-8222-222222222222";

describe("shop drawings per item", () => {
  it("reads each item's state: not needed, waiting, with the lead designer, with the client, changes asked, signed", () => {
    expect(itemDrawingState({ needed: false, status: null })).toBe("not_needed");
    expect(itemDrawingState({ needed: true, status: null })).toBe("waiting");
    expect(itemDrawingState({ needed: true, status: "with_lead_designer" })).toBe("with_lead_designer");
    expect(itemDrawingState({ needed: true, status: "with_client" })).toBe("with_client");
    expect(itemDrawingState({ needed: true, status: "changes_asked" })).toBe("changes_asked");
    // A signed item stays signed even if the team later decides it needs no drawing.
    expect(itemDrawingState({ needed: false, status: "signed" })).toBe("signed");
  });

  it("supplier and catalogue items with their drawing skip shop drawings; bespoke and made-to-order items need them", () => {
    const supplier = drawingNeed({ kind: "item", catalogItemId: "c1", itemType: "product", catalogDrawingUrl: "https://example.com/sofa.pdf", override: null }, false);
    expect(supplier.needed).toBe(false);
    expect(itemDrawingState({ needed: supplier.needed, status: null })).toBe("not_needed");
    expect(() => assertCanUpload("not_needed", 0)).toThrow("This item doesn't need a shop drawing.");
    expect(drawingNeed({ kind: "item", catalogItemId: null, itemType: null, catalogDrawingUrl: null, override: null }, false).needed).toBe(true);
    expect(drawingNeed({ kind: "item", catalogItemId: "c2", itemType: "assembly", catalogDrawingUrl: null, override: null }, false).needed).toBe(true);
  });

  it("takes a new version only while the item waits for one or after changes were asked", () => {
    expect(() => assertCanUpload("waiting", 0)).not.toThrow();
    expect(() => assertCanUpload("changes_asked", 1)).not.toThrow();
    expect(() => assertCanUpload("with_lead_designer", 2)).toThrow("Drawing V2 is with the lead designer.");
    expect(() => assertCanUpload("with_client", 2)).toThrow("Drawing V2 is with the client.");
    expect(() => assertCanUpload("signed", 3)).toThrow(/signed and locked/);
  });

  it("the lead designer approves a version (it goes to the client) or returns it with the reason", () => {
    expect(reviewOutcome("with_lead_designer", "approve", "")).toBe("with_client");
    expect(reviewOutcome("with_lead_designer", "return", "Hinge side is wrong")).toBe("returned");
    expect(() => reviewOutcome("with_lead_designer", "return", "")).toThrow("Say what needs to change.");
    expect(() => reviewOutcome("with_client", "approve", "")).toThrow(/isn't waiting for the lead designer/);
    expect(() => reviewOutcome("with_lead_designer", "maybe", "")).toThrow(/Approve the drawing/);
  });

  it("validates a version's quantity and sizes as exact decimals in the workspace's unit", () => {
    expect(drawingInput({ width: "2400", height: 2700, depth: "600.5" }, { quantity: "4.5" }, "mm"))
      .toEqual({ quantity: "4.5", width: "2400", height: "2700", depth: "600.5", dimensionUnit: "mm", note: "" });
    expect(drawingInput({ quantity: "2", dimensionUnit: "in", note: "  Left hand " }, { quantity: "1" }, "mm")).toMatchObject({ quantity: "2", dimensionUnit: "in", note: "Left hand" });
    expect(() => drawingInput({ dimensionUnit: "yards" }, { quantity: "1" }, "mm")).toThrow("Choose the unit of the sizes.");
    expect(() => decimalInput("-3", "width", false)).toThrow(/above zero/);
    expect(() => decimalInput("1e3", "width", false)).toThrow(/above zero/);
    expect(decimalInput("", "width", false)).toBeNull();
  });

  it("a client signs only the current versions waiting for them, each item once", () => {
    const waiting = [{ id: V1, lineId: "l1", status: "with_client" as const, current: true }, { id: V2, lineId: "l2", status: "with_client" as const, current: true }];
    expect(() => assertSignable([V1, V2], waiting)).not.toThrow();
    expect(() => assertSignable([], waiting)).toThrow("Choose the items to sign.");
    expect(() => assertSignable([V1, V1], waiting)).toThrow("Choose each item once.");
    expect(() => assertSignable([V1], [{ ...waiting[0], status: "with_lead_designer" }])).toThrow(/aren't waiting for your signature/);
    expect(() => assertSignable([V1], [{ ...waiting[0], current: false }])).toThrow(/aren't waiting for your signature/);
  });

  it("binds a signing code to exactly the versions chosen, in any order", () => {
    const batch = signingBatchId(CASE, [V1, V2]);
    expect(batch).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(signingBatchId(CASE, [V2, V1.toUpperCase()])).toBe(batch);
    expect(signingBatchId(CASE, [V1])).not.toBe(batch);
  });

  it("signing locks each item to its version's quantity and sizes and keeps the signature's evidence", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = { query: async (sql: string, values: unknown[] = []) => { calls.push({ sql, values }); return { rows: [], rowCount: 0 }; } };
    const versions = [
      { id: V1, lineId: "l1", itemId: "i1", status: "with_client" as const, current: true, sha256: "a".repeat(64), title: "Wardrobe", createdBy: "u1", number: 2 },
      { id: V2, lineId: "l2", itemId: "i2", status: "with_client" as const, current: true, sha256: "b".repeat(64), title: "Vanity", createdBy: "u1", number: 1 },
    ];
    const result = await signItemDrawings(db, { workspaceId: "w", projectId: "p", caseId: CASE, versionIds: [V1, V2], batchId: signingBatchId(CASE, [V1, V2]),
      grant: { id: "g", name: "Client" }, challengeId: "c", commandId: "k", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Mobile Safari/604.1", versions });
    expect(result).toEqual({ signed: 2, lines: ["l1", "l2"] });
    const locks = calls.filter((call) => /UPDATE project_item_drawings item SET status = 'signed', locked_at = now\(\), locked_version_id = version.id, locked_quantity = version.quantity/.test(call.sql));
    expect(locks.map((call) => call.values.slice(1))).toEqual([["i1", V1], ["i2", V2]]);
    const evidence = calls.filter((call) => call.sql.includes("INSERT INTO project_item_drawing_signatures"));
    expect(evidence.map((call) => [call.values[5], call.values[8], call.values[11], call.values[12]]))
      .toEqual([[V1, "Client", "Safari on iPhone", "a".repeat(64)], [V2, "Client", "Safari on iPhone", "b".repeat(64)]]);
    // A version that isn't waiting for the client is never signed.
    calls.length = 0;
    await expect(signItemDrawings(db, { workspaceId: "w", projectId: "p", caseId: CASE, versionIds: [V1], batchId: "x", grant: { id: "g", name: "Client" }, challengeId: "c",
      commandId: "k", userAgent: null, versions: [{ ...versions[0], status: "signed" }] })).rejects.toThrow(/aren't waiting/);
    expect(calls).toEqual([]);
  });
});

describe("delivery proof per item", () => {
  it("refuses delivered without a photo, with one clear message", () => {
    expect(() => deliveryNext("pending", "delivered", 0)).toThrow(MISSING_PROOF);
    expect(() => deliveryNext("pending", "installed", 0)).toThrow(MISSING_PROOF);
  });

  it("moves forward only: pending to delivered or installed, delivered to installed", () => {
    expect(deliveryNext("pending", "delivered", 1)).toBe("delivered");
    expect(deliveryNext("pending", "installed", 2)).toBe("installed");
    expect(deliveryNext("delivered", "installed", 1)).toBe("installed");
    expect(() => deliveryNext("delivered", "delivered", 1)).toThrow("This item is already delivered.");
    expect(() => deliveryNext("installed", "installed", 1)).toThrow(/already delivered and installed/);
    expect(() => deliveryNext("pending", "lost", 1)).toThrow(/Mark the item delivered/);
  });

  it("counts the items that pass for the job's journey", () => {
    const facts = proofFacts([
      { needed: true, drawing: "signed", delivery: "installed" },
      { needed: true, drawing: "with_client", delivery: "delivered" },
      { needed: false, drawing: null, delivery: null },
    ]);
    expect(facts).toEqual({ drawings: { tracked: true, applicable: 2, signed: 1 }, delivery: { tracked: true, applicable: 3, done: 2 } });
    expect(proofFacts([{ needed: true, drawing: null, delivery: null }])).toEqual({ drawings: { tracked: false, applicable: 1, signed: 0 }, delivery: { tracked: false, applicable: 1, done: 0 } });
  });
});
