import {describe,it,expect} from 'vitest';
import {parseQuotePresentation} from './commercial.domain';
const presentation={version:1,pageBackground:'#ffffff',textColor:'#000000',accentColor:'#000000',pages:[{id:'custom:intro',kind:'custom',title:'Intro',elements:[]}]};
describe('quotation page order',()=>{
 it('preserves visibility for any page including scope',()=>expect(parseQuotePresentation({...presentation,hiddenPages:['cover','scope','custom:intro']}).hiddenPages).toEqual(['cover','scope','custom:intro']));
 it('rejects unknown hidden page identifiers',()=>expect(()=>parseQuotePresentation({...presentation,hiddenPages:['unknown']})).toThrow());
 it('preserves chosen reading order and custom pages',()=>{expect(parseQuotePresentation({...presentation,pageOrder:['cover','custom:intro','scope','terms']}).pageOrder).toEqual(['cover','custom:intro','scope','terms']);});
 it('keeps legacy presentations without imposing an order',()=>{expect(parseQuotePresentation(presentation).pageOrder).toBeUndefined();});
 it.each([['cover','terms'],['scope','scope'],['scope','missing'],[]])('rejects invalid order %j',(...order)=>{expect(()=>parseQuotePresentation({...presentation,pageOrder:order})).toThrow();});
});
