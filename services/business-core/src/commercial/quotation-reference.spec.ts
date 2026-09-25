import {describe,it,expect} from 'vitest';
import {parseQuotePresentation} from './commercial.domain';
import {referencePresentation,referenceTerms} from '../../../../apps/web/lib/commercial/quotation-reference-template';
import type {Quote} from './commercial.types';
const quote={id:'q1',number:1,title:'Villa',terms:referenceTerms,lines:[],paymentTerms:[]} as unknown as Quote;
describe('reference presentation persistence',()=>{
 it('round-trips all editable reference pages and client details',()=>{const presentation=referencePresentation(quote,'Palm Living Interiors','Current Client');expect(parseQuotePresentation(presentation)).toEqual(presentation);});
 it('rejects external image URLs and strips unknown detail properties',()=>{const presentation=referencePresentation(quote,'Studio','Client');expect(()=>parseQuotePresentation({...presentation,details:{clientLogo:'https://example.com/private.png'}})).toThrow();expect(parseQuotePresentation({...presentation,details:{clientName:'Client',unsafe:'hidden'}}).details).toEqual({clientName:'Client'});});
});
