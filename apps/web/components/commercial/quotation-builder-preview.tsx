'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import {useEffect,useRef,useState} from 'react';
import type {Quote,PortalBrand} from '@/lib/commercial/types';
import {QuotationDocumentPage,quotationPages} from './quotation-document-page';
import {QuoteRichText} from './quotation-rich-text';
import {QuotationLinkedBlock} from './quotation-linked-block';
import {builderPresentation} from '@/lib/commercial/quotation-builder-document';
import {isReferenceLayout,referenceItemPage} from '@/lib/commercial/quotation-reference-template';
import { Button, SelectField } from '@/design-system';
import styles from './quotation-builder-preview.module.css';

export function QuotationBuilderPreview({quote,brand,customerName,initialPageId='cover',allPages=false,fitWidth=false}:{quote:Quote;brand?:PortalBrand;customerName:string;initialPageId?:string;allPages?:boolean;fitWidth?:boolean}) {
  const t = useT();
 const container=useRef<HTMLDivElement>(null),[scale,setScale]=useState(.6);
 const design=quote.presentation??builderPresentation(quote,brand?.name??'',customerName);
 quote={...quote,presentation:design};
 const pages=quotationPages(quote,t);
 const [selected,setSelected]=useState(initialPageId==='scope'?'items:0':initialPageId);
 const index=Math.max(0,pages.findIndex(page=>page.id===selected));
 const selectedPage=pages[index];
 useEffect(()=>{const element=container.current;if(!element)return;const resize=()=>{const availableHeight=Math.max(250,window.innerHeight-element.getBoundingClientRect().top-90);setScale(Math.max(.15,Math.min(1,(element.clientWidth-48)/940,(fitWidth?Infinity:availableHeight/(selectedPage?.kind==='custom'?1329:1150)))));};resize();const observer=new ResizeObserver(resize);observer.observe(element);window.addEventListener('resize',resize);return()=>{observer.disconnect();window.removeEventListener('resize',resize);};},[selectedPage?.kind,fitWidth]);
 return <div ref={container} className={styles.preview} aria-label={t("Quotation preview")}>
  {!pages.length&&<p role="status">{t("All pages are hidden. Return to editing and enable a page from Pages.")}</p>}
  {!allPages&&pages.length>0&&<nav className={styles.navigation} aria-label={t("Preview pages")}><Button size="compact" isDisabled={index===0} onPress={()=>setSelected(pages[index-1].id)}>{t("← Previous")}</Button><SelectField aria-label={t("Preview page")} label={<span className="wd-visually-hidden">{t("Preview page")}</span>} items={pages.map((page,i)=>({id:page.id,label:`${i+1}. ${page.title}`}))} selectedKey={selectedPage?.id??null} onSelectionChange={key=>key!==null&&setSelected(String(key))}/><span>{t("{current} of {total}",{current:index+1,total:pages.length})}</span><Button size="compact" isDisabled={index===pages.length-1} onPress={()=>setSelected(pages[index+1].id)}>{t("Next →")}</Button></nav>}
  {pages.filter(page=>allPages||page.id===selectedPage?.id).map((page)=>{const override=design.pages.find(item=>item.id===page.id)??(isReferenceLayout(design.template)&&page.id.startsWith('items:')?referenceItemPage(Number(page.id.slice(6))):undefined),height=page.kind==='custom'?1329:1150;return <div key={page.id} data-print-page>
   <div className={styles.label}>{t(page.id.startsWith('items:')?"Page {number} / {count} · Scope & Items":"Page {number} / {count}",{number:pages.indexOf(page)+1,count:pages.length})}</div>
   <div className={styles.space} style={{width:940*scale,height:height*scale}}><article className={styles.paper} dir="ltr" aria-label={t("{title} preview",{title:page.title})} style={{width:940,height,transform:`scale(${scale})`,backgroundColor:override?.background??design.pageBackground,backgroundImage:override?.backgroundImage?`url(${override.backgroundImage})`:undefined}}>
    {page.kind!=='custom'&&<QuotationDocumentPage quote={quote} brand={brand} customerName={customerName} page={page} pageCount={pages.length} pageIndex={index} selectedItem="" onSelect={()=>{}} onAdd={()=>{}} preview/>}
    {(override?.elements??[]).map(element=><div key={element.id} data-quotation-element={element.id} className={styles.element} style={{left:element.x,top:element.y,width:element.width,height:element.height,fontSize:element.fontSize??28,color:element.color??design.textColor,textAlign:element.align??'left'}}>{element.id.startsWith('data:')?<QuotationLinkedBlock id={element.id} quote={quote}/>:element.type==='image'?<img alt={t("Quotation artwork")} src={element.src}/>:element.richText?<QuoteRichText node={element.richText}/>:element.text}</div>)}
   </article></div>
  </div>;})}
 </div>;
}
