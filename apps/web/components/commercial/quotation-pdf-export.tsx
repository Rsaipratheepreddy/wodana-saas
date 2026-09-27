'use client';
import {useEffect,useRef} from 'react';
import type {Quote,PortalBrand} from '@/lib/commercial/types';
import {QuotationBuilderPreview} from './quotation-builder-preview';
import {useT} from '@/lib/i18n/i18n-provider';
/** Print a snapshot of all enabled pages, including unsaved edits, without changing the editor. */
export function QuotationPdfExport({quote,brand,customerName,onDone,onError}:{quote:Quote;brand?:PortalBrand;customerName:string;onDone:()=>void;onError:(message:string)=>void}){
 const t=useT();
 const content=useRef<HTMLDivElement>(null),callbacks=useRef({onDone,onError});callbacks.current={onDone,onError};
 useEffect(()=>{let cancelled=false;const frame=document.createElement('iframe');frame.title=t('Quotation PDF');frame.style.cssText='position:fixed;left:-10000px;top:0;width:940px;height:1329px;border:0';document.body.appendChild(frame);
 async function print(){try{
 const doc=frame.contentDocument,win=frame.contentWindow;if(!doc||!win||!content.current)throw new Error(t('Could not prepare the PDF. Please try again.'));
 const styles=Array.from(document.querySelectorAll('style,link[rel="stylesheet"]')).map(node=>node.outerHTML).join('');
 doc.open();doc.write('<!doctype html><html><head><meta charset="utf-8">'+styles+`<style>@page{size:A4;margin:0}html,body{margin:0!important;padding:0!important;background:white!important}body>div{display:block!important;height:auto!important;min-height:0!important;overflow:visible!important;padding:0!important;margin:0!important}[data-print-page]{position:relative!important;width:210mm!important;height:297mm!important;break-after:page;page-break-after:always;overflow:hidden!important;margin:0!important;padding:0!important}[data-print-page]:last-child{break-after:auto;page-break-after:auto}[data-print-page]>div:first-child{display:none!important}[data-print-page]>div:last-child{width:940px!important;height:1329px!important;position:relative!important;zoom:0.8444}[data-print-page] article{transform:none!important;box-shadow:none!important;position:absolute!important;top:0!important;left:0!important}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}</style></head><body>`+content.current.innerHTML+'</body></html>');doc.close();doc.title=quote.title||t('Quotation');
 await Promise.all(Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map(link=>new Promise<void>(resolve=>{if((link as HTMLLinkElement).sheet)return resolve();link.addEventListener('load',()=>resolve(),{once:true});link.addEventListener('error',()=>resolve(),{once:true});setTimeout(resolve,5000);})));
 const inherited=getComputedStyle(content.current);for(const variable of ['--font-montserrat','--font-inter','--wd-font-sans']){const value=inherited.getPropertyValue(variable);if(value)doc.documentElement.style.setProperty(variable,value);}
 await doc.fonts.ready;
 await Promise.all([...Array.from(doc.images).map(img=>img.decode()),...(quote.presentation?.pages??[]).filter(page=>page.backgroundImage).map(async page=>{const img=doc.createElement('img');img.src=page.backgroundImage!;await img.decode();})]);
 const printPages=Array.from(doc.querySelectorAll('[data-print-page]'));
 const overflowing=printPages.findIndex(page=>Array.from(page.querySelectorAll('[data-quotation-element]')).some(element=>element.scrollHeight>element.clientHeight+3||element.scrollWidth>element.clientWidth+3));
 if(overflowing>=0)throw new Error(t('Page {number} has overflowing content. Resize its text or image blocks, or shorten long item specifications before exporting.',{number:overflowing+1}));
 if(cancelled)return;win.focus();win.print();callbacks.current.onDone();
 }catch(error){if(!cancelled)callbacks.current.onError(error instanceof Error?error.message:t('Could not prepare the PDF.'));}}
 void print();return()=>{cancelled=true;frame.remove();};
 },[quote,t]);
 return <div ref={content} aria-hidden="true" style={{position:'fixed',left:-20000,top:0,width:940,pointerEvents:'none'}}><QuotationBuilderPreview quote={quote} brand={brand} customerName={customerName} allPages/></div>;
}
