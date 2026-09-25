import type {CommercialState, Quote, QuoteCanvasElement, QuoteCanvasPage, QuotePresentation} from './types';
import artwork from './proposal-reference.json';

export const referenceTerms = `${artwork.termsLeft}\n\n${artwork.termsRight}`;
export const referenceTermsFor = (quote:Quote) => quote.status && quote.status !== 'draft' ? quote.terms : !quote.terms?.trim()||quote.terms==='Payment terms and delivery dates are subject to the agreed contract.'?referenceTerms:quote.terms;
export const referenceBrief = 'Experience the essence of luxury living with Palm Living Interiors. As a British-owned manufacturing and interior design company with a commitment to exceptional customer service and high-end quality, we blend sophistication with comfort at every touchpoint of our projects.';
const background = '#aaa696', ink = '#eeede5';
const text = (id:string, value:string, x:number,y:number,width:number,height:number,fontSize=19,color=ink,align:'left'|'center'|'right'='left'):QuoteCanvasElement => ({id,type:'text',text:value,x,y,width,height,fontSize,color,align});
const image = (id:string,src:string,x:number,y:number,width:number,height:number):QuoteCanvasElement=>({id,type:'image',src,x,y,width,height});
const monogram = () => image('brand-mark',artwork.monogram,773,1163,148,143);
const page = (id:string,elements:QuoteCanvasElement[],backgroundImage?:string):QuoteCanvasPage=>({id,kind:'custom',background,elements,...(backgroundImage?{backgroundImage}:{})});
const termsColumn = (id:string,value:string,x:number):QuoteCanvasElement=>({...text(id,value,x,526,414,710,10.7),richText:{type:'doc',content:value.split('\n').map(line=>({type:'paragraph',content:line?[{type:'text',text:line,...(line===line.toUpperCase()&&/[A-Z]/.test(line)?{marks:[{type:'bold'}]}:{})}]:[]}))}});
function textChunks(value:string){const chunks:string[]=[];let remaining=value;while(remaining.length>3200){const space=remaining.lastIndexOf(' ',3200),cut=space>2000?space:3200;chunks.push(remaining.slice(0,cut));remaining=remaining.slice(cut).trimStart();}chunks.push(remaining);return chunks;}

/** A clean, editable version of the supplied reference. No sample customer or scope is copied. */
export function referencePresentation(quote:Quote,company:string,customer:string,context?:CommercialState):QuotePresentation {
 const brand=company||'Palm Living Interiors';
 const palm=/palm living/i.test(brand);
 const companyLogo=context?.portalBrand?.logo?.startsWith('data:image/')?context.portalBrand.logo:palm?artwork.logo:undefined;
 const contact=context?.contacts.find(contact=>contact.name===customer)??context?.contacts[0];
 const terms=referenceTermsFor(quote);
 const isReferenceTerms=terms===referenceTerms;
 const termChunks=isReferenceTerms?[artwork.termsLeft,artwork.termsRight]:textChunks(terms);
 const pages:QuoteCanvasPage[]=[
  page('cover',[
   ...(companyLogo?[image('company-logo',companyLogo,110,80,720,391)]:[text('company-name',brand,85,155,770,220,64,ink,'center')]),
   text('proposal-title','PROPOSAL',100,566,740,72,49,ink,'center'),
   text('data:cover-client','',175,696,590,92,27,ink,'center'),
   text('data:client-logo','',790,700,100,80),
   text('created-label','CREATED BY:',43,1080,620,40,25),
   text('data:prepared-by','',43,1129,730,81,27),
   text('data:issued-date','',43,1255,690,35,19),...(palm?[monogram()]:[]),
  ]),
  page('custom:introduction',[
   text('introduction-copy',referenceBrief,84,91,435,240,19,'#777568','center'),
   ...(palm?[monogram()]:[]),
  ],artwork.introduction),
  page('custom:letter',[
   ...(palm?[image('letter-mark',artwork.monogram,750,60,83,110)]:[]),
   text('data:project-details','',64,195,795,86),
   text('letter-introduction',`${brand} are pleased to present the enclosed proposal for the project referenced above, which is submitted for your review and approval.`,64,296,812,62),
   text('data:estimate','',64,373,812,58),
   text('data:proposal-totals','',64,449,570,140,18),
   text('data:validity','',64,642,812,50),
   text('letter-leadtime','Our lead time of all built-in works & joinery & bespoke furnitures is 8–12 weeks after client approval. By signing below you agree with our Terms & Conditions.',64,696,812,70),
   text('letter-help','Should you require any additional information or clarification during your review and evaluation process, please do not hesitate to contact us.',64,772,812,61),
   text('letter-closing','We look forward to working with you.\n\nKind regards,',64,846,812,90),
   text('data:prepared-by','',64,1038,740,90),
   text('signature','___________________________________\nClient Signature',70,1160,700,64,18),
  ]),
  page('terms',[
   image('terms-photo-one',artwork.termsOne,41,69,270,362),
   image('terms-photo-two',artwork.termsTwo,336,69,270,362),
   image('terms-photo-three',artwork.termsThree,625,69,270,362),
   text('terms-heading','TERMS AND CONDITIONS',40,470,860,50,23,ink,'center'),
   termsColumn('field:terms-left',termChunks[0]??'',33),
   termsColumn('field:terms-right',termChunks[1]??'',491),
   text('website','WWW.PALMLIVINGAE.COM',120,1285,700,26,15,ink,'center'),
  ]),
  ...termChunks.slice(2).map((chunk,index)=>page(`custom:terms-${index}`,[text(`field:terms-extra-${index}`,chunk,64,100,812,1110,18)])),
  ...[quote.inclusions?['inclusions','Included in this proposal',quote.inclusions]:null,quote.exclusions?['exclusions','Excluded from this proposal',quote.exclusions]:null].filter((entry):entry is string[]=>Boolean(entry)).flatMap(([field,heading,body])=>textChunks(body).map((chunk,index)=>page(`custom:${field}-${index}`,[text(`${field}-heading`,heading,64,70,812,80,32),text(`field:${field}:${index}`,chunk,64,200,812,1050,18)]))),
  page('custom:closing',[
   image('closing-photo',artwork.closing,0,0,940,1000),
   text('closing-heading','CONTACT US',24,1041,840,62,38),
   text('closing-contact','+971 52 800 4062\n\nInfo@palmlivingae.com\n\n@palmlivingae\n\nwww.palmlivingae.com\n\n1st Floor, Andalus Centro, Jumeirah Golf Estates',28,1120,820,180,16),
   ...(palm?[monogram()]:[]),
  ]),
 ];
 return {version:1,template:'palm-reference-v1',pageBackground:background,textColor:ink,accentColor:background,
  details:{companyName:brand,clientName:quote.cover?.preparedFor||customer,clientPhone:context?.customerPhone||contact?.phone||'',clientEmail:context?.customerEmail||'',projectName:context?.title||quote.title,location:quote.cover?.location||context?.customerAddress||'',reference:`QT-${quote.id.slice(0,8).toUpperCase()} · Rev ${quote.number}`,date:quote.createdAt?.slice(0,10)||'',preparedBy:quote.cover?.signerName||'',estimator:'',manager:''},
  scopeColumns:{hidden:[],custom:[]},pageOrder:['cover','custom:introduction','custom:letter','scope',...pages.slice(3).map(page=>page.id)],pages};
}

export function referenceItemPage(start:number):QuoteCanvasPage {
 return page(`items:${start}`,[...(start===0?[text('data:item-letterhead','',79,87,782,165,11,'#333333')]:[]),text(`data:reference-items:${start}`,'',79,start===0?252:87,782,start===0?984:1149,10,'#333333')]);
}

/** Reserve space for wrapped specifications, room headings and the final totals. */
export function referenceItemGroups(lines:Quote['lines']):{start:number;count:number}[]{
 const groups:{start:number;count:number}[]=[];
 let start=0,used=0,count=0;
 for(let index=0;index<lines.length;index++){
  const line=lines[index];
  const description=[line.specification,line.material,line.finish,...(line.materialRows??[]).map(row=>`${row.name} ${row.specification}`),...(line.customMaterials??[]).map(row=>`${row.name} ${row.specification}`)].filter(Boolean).join(' · ');
  const row=Math.max(116,Math.ceil(description.length/24)*11+16,Math.ceil((line.title??'').length/30)*11+16);
  const room=(!count||lines[index-1]?.room!==line.room)?22:0;
  if(count&&(count>=7||used+row+room>(index===lines.length-1?830:940))){groups.push({start,count});start=index;used=0;count=0;}
  used+=row+(!count?22:room);count++;
 }
 groups.push({start,count});
 return groups;
}
