import {describe,it,expect} from 'vitest';
import {normalizeItemDimension,validateSelectionChange} from './item-specification.service';
import {SaveItemSpecificationDto} from './item-specification.dto';
import {plainToInstance} from 'class-transformer';
import {validate} from 'class-validator';
const material={id:'a',application:'Shutter',materialId:null,brandId:null,finishId:null,productName:'Laminate',productCode:'00012',finishCode:'001-M',stockSize:'1 mm',status:'selected',selectedBy:'Client',selectedAt:'2026-09-07',evidence:'Meeting 01',assetIds:[]};
describe('item specification boundaries',()=>{
 it.each([[8,'ft',2.4384],[12,'in',.3048],[250,'mm',.25],[120,'cm',1.2],[3,'m',3]])('normalizes %s %s to metres', (value,unit,result)=>expect(normalizeItemDimension(Number(value),String(unit))).toBe(result));
 it('does not infer a conversion for an unknown unit',()=>expect(()=>normalizeItemDimension(2,'sheet')).toThrow('supported length unit'));
 it('preserves an absent approximate value',()=>expect(normalizeItemDimension(null,'ft')).toBeNull());
 it('requires renewed confirmation after a selected code changes',()=>expect(()=>validateSelectionChange({...material,finishCode:'002-M'},material)).toThrow('fresh client confirmation'));
 it('accepts the changed code as proposed without altering the old selection',()=>{const next={...material,status:'proposed',finishCode:'002-M'};expect(()=>validateSelectionChange(next,material)).not.toThrow();expect(material.finishCode).toBe('001-M');});
 it('accepts an explicitly recorded new confirmation',()=>expect(()=>validateSelectionChange({...material,finishCode:'002-M',evidence:'Meeting 02: new sample chosen'},material)).not.toThrow());
 it('keeps client-provided verification flags outside the editable contract',async()=>{const spec=plainToInstance(SaveItemSpecificationDto,{version:0,refinedRequirement:'',construction:'',inclusions:'',exclusions:'',assumptions:'',materials:[],designRefs:[],dimensions:[{id:'e56299c6-3da3-402a-a9ac-3995bb37b9d4',name:'Width',unit:'ft',basis:'finished_item',approximate:8,measured:null,source:'client',evidence:'',verification:'verified'}]});expect(await validate(spec,{whitelist:true,forbidNonWhitelisted:true})).not.toHaveLength(0);});
});
