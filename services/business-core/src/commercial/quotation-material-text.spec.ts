import { expect, it } from "vitest";
import { quotationMaterialText } from "./quotation-material-text";
it("carries accepted catalog, finish and client-supplied material details into execution", () => {
  expect(quotationMaterialText({ material: "Oak veneer", finish: "Matte lacquer", customMaterials: [{id:"custom",name:"Marble",brand:"Client",code:"M20",specification:"20 mm polished slab",suppliedByClient:true}] })).toBe("Oak veneer\n\nMatte lacquer\n\nMarble · Client · M20 · 20 mm polished slab · Client supplied");
});

it("preserves every accepted material row in its original order", () => {
  expect(quotationMaterialText({
    material: "",
    finish: "",
    customMaterials: [],
    materialRows: [
      { id: "m1", name: "MR plywood", specification: "18 mm", type: "material", quantity: 1, unit: "sheet", rate: 50, suppliedByClient: false },
      { id: "m2", name: "Natural Veneer", specification: "FIN-VEN-NAT", type: "finish", quantity: 1, unit: "m²", rate: 75, suppliedByClient: false },
    ],
  })).toBe("MR plywood · 18 mm\n\nNatural Veneer · FIN-VEN-NAT");
});
