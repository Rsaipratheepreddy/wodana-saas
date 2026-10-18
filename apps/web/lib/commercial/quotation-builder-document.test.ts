import {describe,it,expect} from 'vitest';
import type {CommercialState, ProposalKit, Quote} from './types';
import {builderPresentation} from './quotation-builder-document';
import {FALLBACK_QUOTE_TERMS,referencePresentation,referenceTermsFor} from './quotation-reference-template';
import {quotationPages} from '@/components/commercial/quotation-document-page';
const quote={id:'quote-123',title:'Villa design',number:1,lines:[],terms:'',paymentTerms:[]} as unknown as Quote;
const pixel='data:image/png;base64,iVBORw0KGgo=';
const kit:ProposalKit={introduction:'We design calm homes.',letterNote:'Lead time is six weeks.',defaultTerms:'FIRST\nOne.\n\nSECOND\nTwo.',defaultExclusions:'',contactDetails:'hello@studio.test',website:'studio.test',introductionImage:pixel,closingImage:null,monogramImage:null,termsImages:[pixel],version:1};
const context=(extra:Partial<CommercialState>={})=>({contacts:[],portalBrand:{name:'Studio',logo:'/api/auth/tenant-logo/studio?v=1',primaryColor:'#1f4d3a',accentColor:'#1f4d3a',welcomeTitle:'',welcomeText:'',supportPhone:'',layout:'minimal'},...extra}) as unknown as CommercialState;
describe('freeform quotation document',()=>{
 it('never replaces terms on a quotation that has left draft, and fills a draft from the firm kit',()=>{
  expect(referenceTermsFor({...quote,status:'accepted',terms:FALLBACK_QUOTE_TERMS},kit)).toBe(FALLBACK_QUOTE_TERMS);
  expect(referenceTermsFor({...quote,status:'issued',terms:''},kit)).toBe('');
  expect(referenceTermsFor({...quote,status:'draft',terms:FALLBACK_QUOTE_TERMS},kit)).toBe(kit.defaultTerms);
  expect(referenceTermsFor({...quote,status:'draft',terms:'Our own'},kit)).toBe('Our own');
  expect(referenceTermsFor({...quote,status:'draft',terms:FALLBACK_QUOTE_TERMS})).toBe(FALLBACK_QUOTE_TERMS);
 });
 it('builds only the pages the firm has content for',()=>{
  const bare=builderPresentation(quote,'Studio','Client');
  expect(bare.template).toBe('palm-reference-v1');
  expect(bare.pageOrder).toEqual(['cover','custom:letter','scope','custom:closing']);
  const full=builderPresentation({...quote,terms:kit.defaultTerms},'Studio','Client',context({proposalKit:kit}));
  expect(full.pageOrder).toEqual(['cover','custom:introduction','custom:letter','scope','terms','custom:closing']);
  expect(full.pages.every(page=>page.kind==='custom')).toBe(true);
 });
 it('uses the firm brand and never another firm content',()=>{
  const result=referencePresentation(quote,'Studio','Client',context({proposalKit:kit}));
  expect(result.details).toMatchObject({companyName:'Studio',companyLogo:'/api/auth/tenant-logo/studio?v=1',clientName:'Client',projectName:'Villa design'});
  expect(result.pages.find(page=>page.id==='cover')?.background).toBe('#1f4d3a');
  const text=JSON.stringify(builderPresentation(quote,'','Client'));
  for(const foreign of ['Palm','palmliving','+971','Jumeirah','British-owned']) expect(text).not.toContain(foreign);
 });
 it('auto-fills current details without mutating the quote',()=>{const result=builderPresentation(quote,'Studio','Client');expect(result.pages[0].kind).toBe('custom');expect(result.details).toMatchObject({clientName:'Client',projectName:'Villa design'});expect(quote.presentation).toBeUndefined();});
 it('keeps an existing edited cover intact on reload',()=>{const first=builderPresentation(quote,'Studio','Client');first.pages[0].elements[0].text='Custom brand';expect(builderPresentation({...quote,presentation:first},'Other','New').pages).toEqual(first.pages);});
 it('renders the custom cover once, expands scope and respects page order',()=>{const presentation=builderPresentation(quote,'Studio','Client');presentation.pages.push({id:'custom:extra',kind:'custom',title:'Closing',elements:[]});presentation.pageOrder=['cover','scope','custom:extra','terms'];const pages=quotationPages({...quote,presentation});expect(pages.map(page=>page.id)).toEqual(['cover','items:0','custom:extra','terms']);expect(pages[0].kind).toBe('custom');});
});
it('uses seven pages for a nine-item scope with an introduction and terms',()=>{const presentation=referencePresentation({...quote,terms:kit.defaultTerms},'Studio','Client',context({proposalKit:kit}));const pages=quotationPages({...quote,presentation,lines:Array.from({length:9},(_,i)=>({id:String(i)})) as Quote['lines']});expect(pages.map(page=>page.id)).toEqual(['cover','custom:introduction','custom:letter','items:0','items:7','terms','custom:closing']);});
