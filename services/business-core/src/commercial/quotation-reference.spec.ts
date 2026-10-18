import {describe,it,expect} from 'vitest';
import {parseQuotePresentation} from './commercial.domain';
import {referencePresentation} from '../../../../apps/web/lib/commercial/quotation-reference-template';
import type {CommercialState, ProposalKit, Quote} from './commercial.types';
const pixel='data:image/png;base64,iVBORw0KGgo=';
const quote={id:'q1',number:1,title:'Villa',terms:'TERMS\nOne.\n\nMORE\nTwo.',lines:[],paymentTerms:[]} as unknown as Quote;
const kit:ProposalKit={introduction:'About us',letterNote:'Lead time',defaultTerms:'',defaultExclusions:'',contactDetails:'hello@studio.test',website:'studio.test',introductionImage:pixel,closingImage:pixel,monogramImage:pixel,termsImages:[pixel,pixel],version:1};
const context={contacts:[],proposalKit:kit,portalBrand:{name:'Studio',logo:'/api/auth/tenant-logo/studio?v=5b3c',primaryColor:'#1f4d3a',accentColor:'#1f4d3a',welcomeTitle:'',welcomeText:'',supportPhone:'',layout:'minimal'}} as unknown as CommercialState;
describe('reference presentation persistence',()=>{
 it('round-trips every page of a firm with a full kit, including its own logo',()=>{const presentation=referencePresentation(quote,'Studio','Current Client',context);expect(parseQuotePresentation(presentation)).toEqual(presentation);});
 it('round-trips a firm with no kit and no logo',()=>{const presentation=referencePresentation(quote,'','Client');expect(parseQuotePresentation(presentation)).toEqual(presentation);});
 it('rejects outside image addresses and strips unknown detail properties',()=>{const presentation=referencePresentation(quote,'Studio','Client');
  expect(()=>parseQuotePresentation({...presentation,details:{clientLogo:'https://example.com/private.png'}})).toThrow();
  expect(()=>parseQuotePresentation({...presentation,details:{companyLogo:'https://example.com/logo.png'}})).toThrow();
  expect(parseQuotePresentation({...presentation,details:{clientName:'Client',unsafe:'hidden'}}).details).toEqual({clientName:'Client'});});
});
