import {describe,it,expect} from 'vitest';
import type {Quote} from './types';
import {builderPresentation} from './quotation-builder-document';
import {referencePresentation,referenceTerms,referenceTermsFor} from './quotation-reference-template';
import {quotationPages} from '@/components/commercial/quotation-document-page';
const quote={id:'quote-123',title:'Villa design',number:1,lines:[],terms:'',paymentTerms:[]} as unknown as Quote;
describe('freeform quotation document',()=>{
 it('never replaces terms on a quotation that has left draft',()=>{const terms='Payment terms and delivery dates are subject to the agreed contract.';expect(referenceTermsFor({...quote,status:'accepted',terms})).toBe(terms);expect(referenceTermsFor({...quote,status:'issued',terms:''})).toBe('');expect(referenceTermsFor({...quote,status:'draft',terms})).toBe(referenceTerms);});
 it('seeds the reference sequence with live scope',()=>{const result=builderPresentation(quote,'Studio','Client');expect(result.template).toBe('palm-reference-v1');expect(result.pageOrder).toEqual(['cover','custom:introduction','custom:letter','scope','terms','custom:closing']);expect(result.pages.every(page=>page.kind==='custom')).toBe(true);});
 it('auto-fills current details without mutating the quote',()=>{const result=builderPresentation(quote,'Studio','Client');expect(result.pages[0].kind).toBe('custom');expect(result.details).toMatchObject({clientName:'Client',projectName:'Villa design'});expect(JSON.stringify(result)).not.toContain('Buthaina');expect(quote.presentation).toBeUndefined();});
 it('keeps an existing edited cover intact on reload',()=>{const first=builderPresentation(quote,'Studio','Client');first.pages[0].elements[0].text='Custom brand';expect(builderPresentation({...quote,presentation:first},'Other','New').pages).toEqual(first.pages);});
 it('renders the custom cover once, expands scope and respects page order',()=>{const presentation=builderPresentation(quote,'Studio','Client');presentation.pages.push({id:'custom:extra',kind:'custom',title:'Closing',elements:[]});presentation.pageOrder=['cover','scope','custom:extra','terms'];const pages=quotationPages({...quote,presentation});expect(pages.map(page=>page.id)).toEqual(['cover','items:0','custom:extra','terms']);expect(pages[0].kind).toBe('custom');});
});
it('uses seven pages for the sample-sized nine-item scope',()=>{const presentation=referencePresentation(quote,'Studio','Client');const pages=quotationPages({...quote,presentation,lines:Array.from({length:9},(_,i)=>({id:String(i)})) as Quote['lines']});expect(pages.map(page=>page.id)).toEqual(['cover','custom:introduction','custom:letter','items:0','items:7','terms','custom:closing']);expect(referenceTerms).toContain('Full prepayment');});
