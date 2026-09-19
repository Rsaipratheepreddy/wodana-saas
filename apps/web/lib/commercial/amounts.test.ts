import { expect, it } from "vitest";
import { acceptedQuoteTotals, acceptedQuoteValue, quoteSelectionTotals, quoteTotals, paymentMilestoneAmounts } from "./client";
it("rounds fractional room quantities and milestone amounts consistently to cents", () => {
 const room = quoteTotals({discount:0,taxRate:0,lines:[{id:"line",room:"Room",title:"Item",specification:"",material:"",finish:"",unit:"m²",unitCost:0,quantity:.5,rate:1.15}]});
 expect(room.total).toBe(.58);
 expect(paymentMilestoneAmounts(room.total,[{percent:25},{percent:75}])).toEqual([.15,.43]);
 expect(paymentMilestoneAmounts(100,[{percent:60}])).toEqual([60]);
 expect(paymentMilestoneAmounts(100,[{percent:33.33},{percent:33.33},{percent:33.34}])).toEqual([33.33,33.33,33.34]);
});

it("keeps priced options outside the base quotation total and margin", () => {
 const lines = [
  {id:"base",room:"Room",title:"Base",specification:"",material:"",finish:"",unit:"nos",unitCost:60,quantity:1,rate:100},
  {id:"option",room:"Room",title:"Upgrade",specification:"",material:"",finish:"",unit:"nos",unitCost:500,quantity:1,rate:1000,optional:true},
 ];
 const totals = quoteTotals({discount:0,taxRate:5,lines});
 expect(totals).toMatchObject({subtotal:100,cost:60,net:100,tax:5,total:105,margin:40});
 expect(quoteSelectionTotals({discount:0,taxRate:5,total:105,lines},["option"])).toEqual({baseTotal:105,optionsTotal:1050,acceptedTotal:1155});
 const accepted = {id:"quote",number:1,kind:"quotation" as const,status:"accepted" as const,title:"Quote",currency:"AED",validUntil:"2099-01-01",discount:0,taxRate:5,terms:"",exclusions:"",requestIds:[],paymentTerms:[],createdAt:"2026-09-18",total:105,lines,clientDecision:{decision:"accept" as const,quoteHash:"hash",selectedOptionLineIds:["option"],baseTotal:105,optionsTotal:1050,acceptedTotal:1155,decidedAt:"2026-09-18",decidedBy:"Client"}};
 expect(acceptedQuoteTotals(accepted)).toMatchObject({total:1155,cost:560});
 expect(acceptedQuoteValue(accepted)).toBe(1155);
});
