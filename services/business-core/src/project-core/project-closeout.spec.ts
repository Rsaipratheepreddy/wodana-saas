import { describe, expect, it } from "vitest";
import { closeOutBlockers, type CloseOut } from "./project-closeout";

const nothing: CloseOut = { owedOrders: [], sharedDrafts: [], inspections: [], moves: [], siteStock: [], openWork: 0, drafts: [], heldStock: [] };

describe("closeOutBlockers", () => {
  it("names everything a person must settle before a project is cancelled", () => {
    expect(closeOutBlockers({
      ...nothing,
      owedOrders: [{ id: "o", number: "PO-0003", supplierName: "Nile Marble", lines: 2 }],
      sharedDrafts: [{ id: "d", number: "PO-0007", kind: "order" }, { id: "r", number: "4", kind: "request" }],
      inspections: [{ id: "g", number: 12, orderNumber: "PO-0003" }],
      moves: [{ id: "m", number: 5 }],
      siteStock: [{ itemName: "Oak", unit: "sheets", quantity: "2", locationName: "Site" }, { itemName: "Glue", unit: "nos", quantity: "1", locationName: "Site" }],
      openWork: 3, drafts: [{ id: "x", number: "PO-0009", kind: "order" }],
    }, false)).toEqual([
      "PO-0003 is still owed goods", "PO-0007 also has other projects' lines", "Price request 4 also has other projects' lines",
      "delivery 12 (PO-0003) waits for inspection", "move 5 is on its way", "2 items are still at the site",
    ]);
  });

  it("also refuses open work and unsent orders when the project completes; its stock elsewhere never blocks", () => {
    const closeOut = { ...nothing, openWork: 1, drafts: [{ id: "r", number: "2", kind: "request" as const }],
      heldStock: [{ itemId: "i", itemName: "Hinges", unit: "nos", quantity: "20", locationId: "l", locationName: "Warehouse" }] };
    expect(closeOutBlockers(closeOut, true)).toEqual(["1 piece of work is open", "Price request 2 was never sent"]);
    expect(closeOutBlockers(closeOut, false)).toEqual([]);
  });
});
