import { describe, expect, it } from "vitest";
import { quotationTemplateContent } from "./quotation-template";
import type { Quote } from "./commercial.types";
it("whitelists reusable quotation content without copying client identity, source IDs, approvals or financial records", () => {
  const source = { id:"client-quote", title:"Private customer name", cover:{preparedFor:"Private customer"}, status:"accepted", approvedBy:"PM", hash:"accepted-hash", requestIds:["client-request"], paymentTemplate:{id:"payment-library"}, currency:"AED", discount:10, taxRate:5, terms:"Agreed terms", exclusions:"Excluded", inclusions:"Included", rooms:[{id:"room1",name:"Bedroom"}], lines:[{ id:"line1", room:"Bedroom", title:"Wardrobe", specification:"18 mm", material:"Oak", finish:"Matte", quantity:16, unit:"m²", rate:1450, unitCost:1000, scopeId:"private-scope", scopeVersion:9, deductsLineId:"private-contract", customMaterials:[{id:"m1",name:"Client veneer",code:"C1",brand:"Client",specification:"Approved sample",suppliedByClient:true}] }], paymentTerms:[{id:"p1",title:"Advance",percent:100,trigger:"On agreement",requiredForRelease:true}] } as unknown as Quote;
  const content = quotationTemplateContent(source);
  expect(Object.keys(content).sort()).toEqual(["rooms","lines","currency","discount","taxRate","inclusions","terms","exclusions","paymentTerms","presentation"].sort());
  expect(content.lines[0]).not.toHaveProperty("scopeId");expect(content.lines[0]).not.toHaveProperty("deductsLineId");
  expect(content.lines[0].rate).toBe(1450);expect(content.lines[0].customMaterials).toEqual(source.lines[0].customMaterials);
  content.lines[0].customMaterials![0].name="Changed copy";expect(source.lines[0].customMaterials![0].name).toBe("Client veneer");
});
