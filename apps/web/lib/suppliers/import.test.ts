import {describe,it,expect} from 'vitest';
import {parseSupplierImport} from './import';
const header=['Supplier name','Supplies','Contact person','WhatsApp / phone','Email','Supplier code','Notes'];
describe('supplier Excel rows',()=>{
 it('preserves international phone text and separates multiple capabilities',()=>{const p=parseSupplierImport([header,[' Boards LLC ','Materials;services','Alex','+1 (202) 555-0101','A@EXAMPLE.COM','boards_1','Notes']]);expect(p.errors).toEqual([]);expect(p.records[0]).toMatchObject({displayName:'Boards LLC',capabilities:['materials','services'],phone:'+12025550101',email:'a@example.com',code:'BOARDS_1',sourceRow:2,version:0});});
 it('flags invalid rows and preserves Excel row numbers around blanks',()=>{const p=parseSupplierImport([header,[],['Bad supplier','unknown','','97150000','not-email']]);expect(p.errors[0]).toMatchObject({sourceRow:3,status:'error'});expect(p.errors[0].detail).toMatch(/country code/);expect(p.errors[0].detail).toMatch(/valid email/);});
 it('rejects missing, duplicate and unknown headings',()=>{expect(()=>parseSupplierImport([['Email'],['a@example.com']])).toThrow(/Supplier name/);expect(()=>parseSupplierImport([['Name','Supplier name']])).toThrow(/Two columns/);expect(()=>parseSupplierImport([['Name','Bank password']])).toThrow(/Unsupported/);});
 it('rejects empty and oversized batches',()=>{expect(()=>parseSupplierImport([header])).toThrow(/no supplier/);expect(()=>parseSupplierImport([header,...Array.from({length:501},()=>['Name','materials'])])).toThrow(/500/);});
 it('does not lose nonempty cells outside the header',()=>{const p=parseSupplierImport([['Name','Supplies'],['Boards','materials','extra']]);expect(p.errors[0].detail).toMatch(/no supported column/);});
});
