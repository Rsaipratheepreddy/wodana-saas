import {render} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import type {Quote} from '@/lib/commercial/types';
import {QuotationLinkedBlock} from './quotation-linked-block';
const line={id:'l1',room:'Living',title:'Sofa',quantity:2,rate:500,unit:'nos'};
const quote={id:'q1',number:1,kind:'quotation',status:'draft',title:'Villa',currency:'SAR',discount:100,taxRate:15,terms:'',exclusions:'',createdAt:'2026-09-20',requestIds:[],total:0,lines:[line],paymentTerms:[],cover:{taxLabel:'VAT'}} as unknown as Quote;
const text=(id:string,q:Quote=quote)=>render(<QuotationLinkedBlock id={id} quote={q}/>).container.textContent;
describe('proposal linked blocks',()=>{
 it('labels tax with the quote tax name and names the pre-tax line once',()=>{
  const totals=text('data:proposal-totals');
  expect(totals).toContain('VAT 15%:');
  expect(totals).toContain('NET AMOUNT:');
  expect(totals?.match(/TOTAL AMOUNT:/g)).toHaveLength(1);
 });
 it('states the estimate after discount',()=>{expect(text('data:estimate')).toMatch(/900\.00/);});
 it('leaves out an unknown location and never invents a validity period',()=>{
  expect(text('data:project-details')).not.toContain('Location');
  expect(text('data:validity')).not.toMatch(/\d+ days/);
 });
});
