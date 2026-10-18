import {describe,it,expect} from 'vitest';
import {parseQuotePresentation} from './commercial.domain';
const base={version:1,pageBackground:'#ffffff',textColor:'#000000',accentColor:'#000000',pages:[]};
describe('quotation columns persistence',()=>{
 it('preserves hidden columns and custom cell values',()=>{const scopeColumns={hidden:['image'],custom:[{id:'brand',name:'Brand',values:{line1:'Acme'}}]};expect(parseQuotePresentation({...base,scopeColumns}).scopeColumns).toEqual(scopeColumns);});
 it('rejects invalid built-in columns',()=>expect(()=>parseQuotePresentation({...base,scopeColumns:{hidden:['unknown'],custom:[]}})).toThrow());
 it('rejects duplicate custom identifiers',()=>expect(()=>parseQuotePresentation({...base,scopeColumns:{hidden:[],custom:[{id:'a',name:'A',values:{}},{id:'a',name:'B',values:{}}]}})).toThrow());
 it('bounds custom cell content',()=>expect(()=>parseQuotePresentation({...base,scopeColumns:{hidden:[],custom:[{id:'a',name:'A',values:{line1:'x'.repeat(2001)}}]}})).toThrow());
});
