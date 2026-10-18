import { describe, expect, it } from "vitest";
import { inspectionWait, lineCells, projectColumns, type LineFacts, type ProjectFacts } from "./project-readiness";

const line = (input: Partial<LineFacts> = {}): LineFacts => ({
  id: "l1", kind: "item", title: "Wardrobe", quantity: "2", unit: "pcs", areaName: "Bedroom", catalogItemId: null, catalogId: null, code: null, itemType: null,
  catalogImageId: null, imageAssetId: null, supply: "make", packaged: true, lineSized: false, lineMaterial: "", installed: "0", ...input,
});
const facts = (input: Partial<ProjectFacts> = {}): ProjectFacts => ({
  catalog: null, drawing: null, latestDrawing: null, materials: [], materialsState: "draft", needs: [], orders: [], ...input,
});

describe("a project line's readiness", () => {
  it("shows what a bespoke made line still needs", () => {
    const cells = lineCells(line(), facts({ drawing: { needed: true, catalogDrawingUrl: null } }));
    expect(cells).toMatchObject({
      picture: { state: "missing" }, size: { state: "missing" }, drawing: { state: "missing" }, materials: { state: "missing" }, labour: { state: "missing" },
      selection: { state: "not_needed" }, purchase: { state: "not_needed" }, production: { state: "missing" }, delivery: { state: "waiting", note: "not_installed" },
    });
  });

  it("takes the picture, size and material from the quotation line", () => {
    const cells = lineCells(line({ imageAssetId: "a1", lineSized: true, lineMaterial: "MR MDF" }), facts());
    expect(cells.picture.state).toBe("done");
    expect(cells.size.state).toBe("done");
    expect(cells.materials).toEqual({ state: "done", note: "from_quote", detail: "MR MDF" });
  });

  it("uses the catalogue item's cells, and needs nothing to make for a ready-made line", () => {
    const cells = lineCells(line({ catalogItemId: "c1", supply: "ready_made", itemType: "ready_made" }), facts({
      catalog: { picture: { state: "done" }, size: { state: "done", note: "from_sheet", detail: "H 80" }, materials: { state: "not_needed" }, labour: { state: "not_needed" } },
      drawing: { needed: false, catalogDrawingUrl: "https://files.example/d.pdf" },
    }));
    expect(cells).toMatchObject({ picture: { state: "done" }, size: { note: "from_sheet" }, drawing: { state: "done", note: "catalogue_drawing" },
      materials: { state: "not_needed" }, labour: { state: "not_needed" }, production: { state: "not_needed" } });
  });

  it("follows the project's drawings: uploaded waits, approved is done, sent back is missing", () => {
    const drawing = { needed: true, catalogDrawingUrl: null };
    expect(lineCells(line(), facts({ drawing, latestDrawing: { status: "uploaded", drawingFiles: 2 } })).drawing).toEqual({ state: "waiting", note: "uploaded" });
    expect(lineCells(line(), facts({ drawing, latestDrawing: { status: "approved", drawingFiles: 2 } })).drawing).toEqual({ state: "done", note: "approved" });
    expect(lineCells(line(), facts({ drawing, latestDrawing: { status: "changes_requested", drawingFiles: 2 } })).drawing).toEqual({ state: "missing", note: "changes_requested" });
  });

  it("reads the client's material choice from the latest sign-off", () => {
    const materials = [{ id: "m1", boqLineIds: ["l1"], clientChoice: true, decision: "approved" as const }];
    expect(lineCells(line(), facts({ materials, materialsState: "signed_off" })).selection).toEqual({ state: "done", note: "signed_off" });
    expect(lineCells(line(), facts({ materials, materialsState: "sent" })).selection).toEqual({ state: "waiting", note: "sent" });
    expect(lineCells(line(), facts({ materials, materialsState: "changed" })).selection.state).toBe("missing");
    expect(lineCells(line(), facts({ materials })).materials).toEqual({ state: "done", note: "material_list" });
    expect(lineCells(line(), facts({ materials: [{ ...materials[0], clientChoice: false }] })).selection.state).toBe("not_needed");
  });

  it("buys by the least advanced need", () => {
    expect(lineCells(line(), facts({ needs: ["received", "required"] })).purchase).toEqual({ state: "missing", note: "required" });
    expect(lineCells(line(), facts({ needs: ["received", "ordered"] })).purchase).toEqual({ state: "waiting", note: "ordered" });
    expect(lineCells(line(), facts({ needs: ["received", "installed"] })).purchase).toEqual({ state: "done", note: "received" });
  });

  it("makes by its work orders: ready only once everything planned is ready", () => {
    expect(lineCells(line(), facts({ orders: [{ status: "in_production", quantity: "2" }] })).production).toEqual({ state: "waiting", note: "in_production" });
    expect(lineCells(line(), facts({ orders: [{ status: "ready", quantity: "1" }] })).production).toEqual({ state: "waiting", note: "in_production" });
    expect(lineCells(line(), facts({ orders: [{ status: "ready", quantity: "1" }, { status: "short_closed", quantity: "1" }] })).production).toEqual({ state: "done", note: "ready" });
    expect(lineCells(line(), facts({ orders: [{ status: "cancelled", quantity: "2" }] })).production.state).toBe("missing");
    // PLM-150: made and checked but waiting for its design inspection, or with snags to fix: not ready yet.
    expect(lineCells(line(), facts({ orders: [{ status: "ready", quantity: "2", inspection: "due" }] })).production).toEqual({ state: "waiting", note: "inspection_due" });
    expect(lineCells(line(), facts({ orders: [{ status: "ready", quantity: "1", inspection: "snags" }, { status: "ready", quantity: "1" }] })).production)
      .toEqual({ state: "waiting", note: "inspection_snags" });
    expect(lineCells(line(), facts({ orders: [{ status: "in_production", quantity: "1" }, { status: "ready", quantity: "1", inspection: "due" }] })).production)
      .toEqual({ state: "waiting", note: "in_production" });
    expect(inspectionWait("in_production", { raw: "due", final: "to_request" })).toBe("due");
    expect(inspectionWait("in_production", { raw: "to_request", final: "to_request" })).toBeNull();
    expect(inspectionWait("ready", { raw: "passed", final: "to_request" })).toBe("waiting");
    expect(inspectionWait("ready", { raw: "not_needed", final: "passed" })).toBeNull();
    expect(inspectionWait("ready", undefined)).toBeNull();
  });

  it("is installed by approved site reports", () => {
    expect(lineCells(line({ installed: "1" }), facts()).delivery).toEqual({ state: "waiting", note: "part_installed" });
    expect(lineCells(line({ installed: "2.0000" }), facts()).delivery).toEqual({ state: "done", note: "installed" });
  });

  it("needs nothing drawn, made or sized for site work", () => {
    const cells = lineCells(line({ kind: "service", supply: "site_work" }), facts());
    expect(Object.values(cells).every((cell) => cell.state === "not_needed")).toBe(true);
  });
});

describe("the project's columns", () => {
  it("drops the columns of delivery areas the project's path doesn't use", () => {
    const settings = { columns: ["picture", "price", "purchase", "production", "delivery"] as never };
    expect(projectColumns(settings, { supply: true, production: false, delivery: true })).toEqual(["picture", "purchase", "delivery"]);
  });
});
