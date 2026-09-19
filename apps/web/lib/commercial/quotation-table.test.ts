import {describe,it,expect} from 'vitest';
import {catalogDimensions,quotationMaterialRows,quotationPhoto,pricedLine,materialsRate} from './quotation-table';
import {newLine} from './client';
describe('quotation sheet compatibility',()=>{
 it('keeps legacy prices and complete long specifications without changing the source',()=>{const note='Veneer finish specification '.repeat(200);const line={...newLine('Kitchen'),material:note,rate:750};const before=JSON.stringify(line);const rows=quotationMaterialRows(line);expect(rows[0].specification).toBe(note);expect(JSON.stringify(line)).toBe(before);expect(pricedLine({...line,materialRows:rows}).rate).toBe(750);expect(materialsRate(rows)).toBe(0);});
 it('uses short material descriptions as names and treats an empty edited table as intentional',()=>{const line={...newLine(),material:'Oak veneer'};expect(quotationMaterialRows(line)[0].name).toBe('Oak veneer');expect(quotationMaterialRows({...line,materialRows:[]})).toEqual([]);});
 it('rejects unsupported or oversized photos before attempting to decode them',async()=>{await expect(quotationPhoto(new File(['<svg/>'],'x.svg',{type:'image/svg+xml'}))).rejects.toThrow('PNG');await expect(quotationPhoto(new File([new Uint8Array(9*1024*1024)],'x.png',{type:'image/png'}))).rejects.toThrow('8 MB');});
 it('prefills only unambiguous scalar catalogue dimensions',()=>{
  const base={id:'w',name:'Sofa',code:'S',kind:'work',version:1,catalogId:'c'};
  expect(catalogDimensions({...base,attributes:[{name:'LENGTH (CM)',value:'200cm'},{name:'DEPTH (CM)',value:'80 cm'},{name:'HEIGHT (CM)',value:'75 cm - seating H 40cm'}]})).toEqual({unit:'cm',length:200,depth:80});
  expect(catalogDimensions({...base,attributes:[{name:'LENGTH (CM)',value:'Sizes are currently not listed on our website'}]})).toBeUndefined();
 });
});
