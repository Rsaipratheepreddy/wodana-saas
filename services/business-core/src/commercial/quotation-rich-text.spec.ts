import {describe,it,expect} from 'vitest';
import {parseQuotationRichText} from './quotation-rich-text';
import {parseQuotePresentation} from './commercial.domain';
const doc={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Hello',marks:[{type:'bold'}]}]},{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Scope'}]}]}]}]};
describe('quotation rich text',()=>{
 it('round-trips formatting through quotation persistence validation',()=>{const result=parseQuotePresentation({version:1,pages:[{id:'cover',kind:'custom',elements:[{id:'title',type:'text',x:0,y:0,width:200,height:80,text:'Hello Scope',richText:doc}]}]});expect(result.pages[0].elements[0].richText).toEqual(doc);});
 it('strips arbitrary attributes',()=>{expect(parseQuotationRichText({type:'doc',content:[{type:'paragraph',attrs:{onclick:'bad'},content:[{type:'text',text:'Safe'}]}]}).content?.[0]).not.toHaveProperty('attrs');});
 it.each(['script','iframe','image'])('rejects unsupported node %s',type=>expect(()=>parseQuotationRichText({type:'doc',content:[{type}]})).toThrow());
 it('rejects link marks and oversized text',()=>{expect(()=>parseQuotationRichText({type:'doc',content:[{type:'text',text:'x',marks:[{type:'link'}]}]})).toThrow();expect(()=>parseQuotationRichText({type:'doc',content:[{type:'text',text:'x'.repeat(4001)}]})).toThrow();});
});
