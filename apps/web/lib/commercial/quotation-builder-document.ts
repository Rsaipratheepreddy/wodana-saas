import type {Quote,QuoteCanvasElement,QuotePresentation,CommercialState} from './types';
import {referencePresentation} from './quotation-reference-template';

/** Editable cover elements; pricing remains in the quote's controlled line items. */
export function builderPresentation(quote:Quote,company:string,customer:string,context?:CommercialState):QuotePresentation {
 const existing=quote.presentation;
 if(!existing)return referencePresentation(quote,company,customer,context);
 if(existing.template==='palm-reference-v1')return {...existing,details:{...referencePresentation(quote,company,customer,context).details,...existing.details}};
 const cover=existing?.pages.find(page=>page.id==='cover');
 const text=(id:string,value:string,x:number,y:number,width:number,height:number,fontSize:number,color='#26382f'):QuoteCanvasElement=>({id:`cover-${id}`,type:'text',text:value,x,y,width,height,fontSize,color,align:'left'});
 const elements:QuoteCanvasElement[]=[
  text('company',company||'Your studio',76,76,788,70,28),
  text('label','PROJECT PROPOSAL',76,290,700,44,16,'#738278'),
  text('title',quote.title,76,365,770,220,52),
  text('subtitle',quote.cover?.subtitle||'Design, thoughtfully considered.',76,615,750,120,24,'#66746b'),
  text('for','PREPARED FOR',76,965,370,36,14,'#738278'),
  text('customer',quote.cover?.preparedFor||customer,76,1010,700,90,26),
  text('reference',`QT-${quote.id.slice(0,8).toUpperCase()}  ·  Revision ${quote.number}`,76,1200,680,40,16,'#738278'),
 ];
 const result:QuotePresentation = {...existing,
  pageOrder:existing?.pageOrder??['cover','scope','payments','terms','acceptance',...(existing?.pages.filter(page=>page.kind==='custom'&&page.id!=='cover').map(page=>page.id)??[])],
  pages:cover?.kind==='custom'?existing!.pages:[{...cover,id:'cover',kind:'custom',title:'Cover page',background:cover?.background??'#ffffff',elements:[...elements,...(cover?.elements??[])]},...(existing?.pages.filter(page=>page.id!=='cover')??[])]};
 result.pages=[...result.pages];
 if(!existing?.pages.some(page=>page.id==='terms'&&page.kind==='custom'))result.pageOrder=[...new Set([...result.pageOrder!,'payments','acceptance'])];
 if(!existing?.pages.some(page=>page.id==='terms'&&page.kind==='custom')){
  for(const [id,title,body] of [['custom:introduction','Introduction',quote.title],['custom:closing','Closing page','Thank you']]){
   if(!result.pages.some(page=>page.id===id))result.pages.push({id,kind:'custom',title,background:'#ffffff',elements:[text(id,body,76,180,788,200,48)]});
  }
  result.pageOrder=[...new Set([result.pageOrder![0],'custom:introduction',...result.pageOrder!.slice(1),'custom:closing'])];
 }
 result.pageOrder=result.pageOrder!.filter(id=>id!=='summary');
 const definitions=[['terms','Terms & conditions'],['payments','Payment schedule'],['acceptance','Acceptance']];
 for(const [id,title] of definitions){
  const old=result.pages.find(page=>page.id===id);if(old?.kind==='custom')continue;
  const heading={...text(`${id}-heading`,title,76,80,788,80,38),id:`${id}-heading`};
  const body:QuoteCanvasElement[]=id==='terms'?[['terms',quote.terms],['inclusions',quote.inclusions],['exclusions',quote.exclusions]].flatMap(([field,value],index)=>[{...text(`${id}-${field}`,value||'',76,220+index*310,788,280,20),id:`field:${field}`}])
   :id==='acceptance'?[text('acceptance-note','Please review the quotation and confirm your acceptance.',76,240,788,150,24),text('acceptance-sign','Client name: ____________________\n\nSignature: _______________________\n\nDate: ___________________________',76,660,788,300,22)]
   :[{...text(`${id}-data`,'',76,250,788,700,20),id:`data:${id}`}];
  result.pages=result.pages.filter(page=>page.id!==id);result.pages.push({...old,id,kind:'custom',title,background:old?.background??'#ffffff',elements:[heading,...body,...(old?.elements??[])]});
 }
 for(let start=0;start<Math.max(1,quote.lines.length);start+=3){const id=`items:${start}`;if(!result.pages.some(page=>page.id===id))result.pages.push({id,kind:'custom',title:start?`Scope · ${start/3+1}`:'Scope & pricing',background:'#ffffff',elements:[{...text(id,'Scope & pricing',76,80,788,80,38),id:`heading:${id}`},{...text(id,'',50,220,840,940,16),id:`data:${id}`} ]});}
 return result;
}
