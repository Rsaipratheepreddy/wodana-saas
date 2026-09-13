import { expect, it } from "vitest";
import { quoteTotals, paymentMilestoneAmounts } from "./client";
it("rounds fractional room quantities and milestone amounts consistently to cents", () => {
 const room = quoteTotals({discount:0,taxRate:0,lines:[{id:"line",room:"Room",title:"Item",specification:"",material:"",finish:"",unit:"m²",unitCost:0,quantity:.5,rate:1.15}]});
 expect(room.total).toBe(.58);
 expect(paymentMilestoneAmounts(room.total,[{percent:25},{percent:75}])).toEqual([.15,.43]);
 expect(paymentMilestoneAmounts(100,[{percent:60}])).toEqual([60]);
 expect(paymentMilestoneAmounts(100,[{percent:33.33},{percent:33.33},{percent:33.34}])).toEqual([33.33,33.33,33.34]);
});
