import { expect, it } from "vitest";
import { applyQuotationTemplate } from "./templates";
import type { Quote, QuotationTemplate } from "./types";
const destination = { id:"destination", status:"draft", kind:"quotation", title:"This client's villa", cover:{preparedFor:"Client B"}, currency:"AED", requestIds:["request-B"] } as Quote;
const template = { content:{ currency:"AED", discount:0, taxRate:5, terms:"Terms", exclusions:"", rooms:[{id:"r1",name:"Kitchen"}], lines:[{id:"l1",room:"Kitchen",title:"Kitchen cabinets",quantity:16,rate:1450,scopeId:"source-scope",customMaterials:[{id:"m1",name:"Marble"}]}], paymentTerms:[{id:"p1",title:"Advance",percent:100}]} } as QuotationTemplate;
it("uses new IDs while preserving customer identity and exact template rates", () => {
  const next=applyQuotationTemplate(destination,template);
  expect(next.id).toBe(destination.id);expect(next.cover).toEqual(destination.cover);expect(next.title).toBe(destination.title);
  expect(next.lines[0].id).not.toBe("l1");expect(next.rooms![0].id).not.toBe("r1");expect(next.paymentTerms[0].id).not.toBe("p1");expect(next.lines[0].customMaterials![0].id).not.toBe("m1");
  expect(next.lines[0]).not.toHaveProperty("scopeId");expect(next.lines[0].rate).toBe(1450);expect(next.lines[0].quantity).toBe(16);expect(next.requestIds).toEqual([]);
});
it("refuses to overwrite a fixed quote or silently convert currencies", () => {
  expect(()=>applyQuotationTemplate({...destination,status:"accepted"},template)).toThrow(/draft/);
  expect(()=>applyQuotationTemplate({...destination,currency:"USD"},template)).toThrow(/converted/);
});
