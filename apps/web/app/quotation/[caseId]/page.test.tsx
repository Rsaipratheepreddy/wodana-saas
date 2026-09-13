import {it,expect,vi} from 'vitest';
import {getCommercial} from '@/lib/commercial/server';
import Page from './page';
import type {CommercialState,Quote} from '@/lib/commercial/types';
vi.mock('@/lib/commercial/server',()=>({getCommercial:vi.fn()}));
vi.mock('@/components/commercial/quotation-print',()=>({QuotationPrint:()=>null}));
vi.mock('next/navigation',()=>({notFound:()=>{throw new Error('Not found');}}));
it('includes material prices and photos in staff print without exposing internal cost',async()=>{
  const materialRows=[{id:'m',name:'Oak',type:'material' as const,specification:'Veneer',quantity:2,unit:'m²',rate:50,suppliedByClient:false}];
  const quote={id:'q',issuedAt:'2026-09-09',lines:[{id:'l',title:'Cabinet',room:'Kitchen',material:'Oak',finish:'',quantity:1,unit:'nos',rate:100,unitCost:45,variant:'Premium',photo:'data:image/webp;base64,YWJjZA==',materialRows,pricingMode:'materials',scopeId:'private'}]} as Quote;
  vi.mocked(getCommercial).mockResolvedValue({data:{quotes:[quote]},customerName:'Sample client'} as CommercialState);
  const page=await Page({params:Promise.resolve({caseId:'c'}),searchParams:Promise.resolve({quote:'q'})});
  expect(page.props.quote.lines[0]).toMatchObject({materialRows,photo:quote.lines[0].photo,variantLabel:'Premium',pricingMode:'materials',rate:100});
  expect(page.props.quote.lines[0]).not.toHaveProperty('unitCost');
  expect(page.props.quote.lines[0]).not.toHaveProperty('scopeId');
});
