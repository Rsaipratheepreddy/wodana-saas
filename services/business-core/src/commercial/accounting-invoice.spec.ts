import {describe,it,expect} from 'vitest';
import {verifiedInvoiceSnapshot as verify,paymentIsVerified} from './accounting-invoice';
const expected={id:'123',amount:100.01,currency:'AED'};
const invoice={id:'123',total:100.01,balance:100.01,currency:'AED',status:'unpaid',paymentUrl:'https://books.zoho.com/payment/example'};
describe('accounting settlement verification',()=>{
 it('never turns an absent or invalid balance into a payment',()=>{for(const balance of [null,undefined,'0',NaN,-1,101])expect(()=>verify({...invoice,balance},expected)).toThrow();});
 it('requires the exact invoice, currency and rounded milestone amount',()=>{for(const patch of [{id:'other'},{total:100},{currency:'USD'}])expect(()=>verify({...invoice,...patch},expected)).toThrow();});
 it('distinguishes partial payment from settlement',()=>{expect(verify({...invoice,balance:30},expected).settled).toBe(false);expect(verify({...invoice,balance:0,status:'paid'},expected).settled).toBe(true);});
 it('does not publish unsafe, void or draft payment links',()=>{for(const paymentUrl of ['javascript:alert(1)','http://example.com','https://user:pass@example.com'])expect(verify({...invoice,paymentUrl},expected).paymentUrl).toBeNull();for(const status of ['draft','void','voided','deleted']){const result=verify({...invoice,status,balance:0},expected);expect(result.paymentUrl).toBeNull();expect(result.settled).toBe(false);}});
});

describe('release payment freshness',()=>{
 it('requires a current settled provider record for linked invoices',()=>{const now=Date.parse('2026-09-07T12:00:00Z'),payment={status:'verified',invoice:{accountId:'company',balance:0,refreshedAt:'2026-09-07T11:00:00Z'}};expect(paymentIsVerified(payment,now)).toBe(true);for(const patch of [{accountId:undefined},{balance:1},{lastError:'Refresh failed'},{refreshedAt:'invalid'},{refreshedAt:'2026-09-06T11:00:00Z'},{refreshedAt:'2026-09-08T11:00:00Z'}])expect(paymentIsVerified({...payment,invoice:{...payment.invoice,...patch}},now)).toBe(false);expect(paymentIsVerified({status:'verified'},now)).toBe(true);expect(paymentIsVerified({status:'proof_submitted'},now)).toBe(false);});
});
