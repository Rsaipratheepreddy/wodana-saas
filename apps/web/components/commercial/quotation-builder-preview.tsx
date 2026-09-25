'use client';
import {useEffect,useRef,useState} from 'react';
import type {Quote,PortalBrand} from '@/lib/commercial/types';
import {QuotationDocumentPage,quotationPages} from './quotation-document-page';
import {QuoteRichText} from './quotation-rich-text';
import {QuotationLinkedBlock} from './quotation-linked-block';
import {builderPresentation} from '@/lib/commercial/quotation-builder-document';
import {referenceItemPage} from '@/lib/commercial/quotation-reference-template';
import styles from './quotation-builder-preview.module.css';

export function QuotationBuilderPreview({quote,brand,customerName,initialPageId='cover',allPages=false,fitWidth=false}:{quote:Quote;brand?:PortalBrand;customerName:string;initialPageId?:string;allPages?:boolean;fitWidth?:boolean}) {
 const container=useRef<HTMLDivElement>(null),[scale,setScale]=useState(.6);
 const design=quote.presentation??builderPresentation(quote,brand?.name??'',customerName);
 quote={...quote,presentation:design};
 const pages=quotationPages(quote);
 const [selected,setSelected]=useState(initialPageId==='scope'?'items:0':initialPageId);
 const index=Math.max(0,pages.findIndex(page=>page.id===selected));
 const selectedPage=pages[index];
 useEffect(()=>{const element=container.current;if(!element)return;const resize=()=>{const availableHeight=Math.max(250,window.innerHeight-element.getBoundingClientRect().top-90);setScale(Math.max(.15,Math.min(1,(element.clientWidth-48)/940,(fitWidth?Infinity:availableHeight/(selectedPage?.kind==='custom'?1329:1150)))));};resize();const observer=new ResizeObserver(resize);observer.observe(element);window.addEventListener('resize',resize);return()=>{observer.disconnect();window.removeEventListener('resize',resize);};},[selectedPage?.kind,fitWidth]);
 return <div ref={container} className={styles.preview} aria-label="Quotation preview">
  {!pages.length&&<p role="status">All pages are hidden. Return to editing and enable a page from Pages.</p>}
  {!allPages&&pages.length>0&&<nav className={styles.navigation} aria-label="Preview pages"><button type="button" disabled={index===0} onClick={()=>setSelected(pages[index-1].id)}>← Previous</button><label>Page <select aria-label="Preview page" value={selectedPage?.id??''} onChange={event=>setSelected(event.target.value)}>{pages.map((page,i)=><option key={page.id} value={page.id}>{i+1}. {page.title}</option>)}</select></label><span>{index+1} of {pages.length}</span><button type="button" disabled={index===pages.length-1} onClick={()=>setSelected(pages[index+1].id)}>Next →</button></nav>}
  {pages.filter(page=>allPages||page.id===selectedPage?.id).map((page)=>{const override=design.pages.find(item=>item.id===page.id)??(design.template==='palm-reference-v1'&&page.id.startsWith('items:')?referenceItemPage(Number(page.id.slice(6))):undefined),height=page.kind==='custom'?1329:1150;return <div key={page.id} data-print-page>
   <div className={styles.label}>Page {pages.indexOf(page)+1} / {pages.length}{page.id.startsWith('items:')?' · Scope & Items':''}</div>
   <div className={styles.space} style={{width:940*scale,height:height*scale}}><article className={styles.paper} dir="ltr" aria-label={`${page.title} preview`} style={{width:940,height,transform:`scale(${scale})`,backgroundColor:override?.background??design.pageBackground,backgroundImage:override?.backgroundImage?`url(${override.backgroundImage})`:undefined}}>
    {page.kind!=='custom'&&<QuotationDocumentPage quote={quote} brand={brand} customerName={customerName} page={page} pageCount={pages.length} pageIndex={index} selectedItem="" onSelect={()=>{}} onAdd={()=>{}} preview/>}
    {(override?.elements??[]).map(element=><div key={element.id} data-quotation-element={element.id} className={styles.element} style={{left:element.x,top:element.y,width:element.width,height:element.height,fontSize:element.fontSize??28,color:element.color??design.textColor,textAlign:element.align??'left'}}>{element.id.startsWith('data:')?<QuotationLinkedBlock id={element.id} quote={quote}/>:element.type==='image'?<img alt="Quotation artwork" src={element.src}/>:element.richText?<QuoteRichText node={element.richText}/>:element.text}</div>)}
   </article></div>
  </div>;})}
 </div>;
}
