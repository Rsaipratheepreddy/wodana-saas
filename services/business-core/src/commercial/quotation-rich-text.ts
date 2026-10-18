import {BadRequestException} from '@nestjs/common';
import type {QuoteRichTextNode} from './commercial.types';
const nodes=new Set(['doc','paragraph','text','heading','bulletList','orderedList','listItem','blockquote','hardBreak','horizontalRule','codeBlock']);
const marks=new Set(['bold','italic','underline','strike','code']);
/** Accept document data only, never arbitrary HTML, styles or executable attributes. */
export function parseQuotationRichText(input:unknown):QuoteRichTextNode {
 let count=0,length=0;
 const invalid=()=>{throw new BadRequestException('Use supported quotation text formatting.');};
 function read(value:unknown,depth:number):QuoteRichTextNode {
  if(!value||typeof value!=='object'||Array.isArray(value)||depth>12||++count>1000)return invalid();
  const node=value as Record<string,unknown>;
  if(typeof node.type!=='string'||!nodes.has(node.type))return invalid();
  const result:QuoteRichTextNode={type:node.type};
  if(node.type==='text'){
   if(typeof node.text!=='string'||(length+=node.text.length)>4000)return invalid();
   result.text=node.text;
  }
  if(node.content!==undefined){if(!Array.isArray(node.content))return invalid();result.content=node.content.map(child=>read(child,depth+1));}
  if(node.marks!==undefined){if(!Array.isArray(node.marks)||node.marks.length>5)return invalid();result.marks=node.marks.map(mark=>{if(!mark||typeof mark!=='object'||typeof mark.type!=='string'||!marks.has(mark.type))return invalid();return {type:mark.type};});}
  if(node.type==='heading'){const level=(node.attrs as {level?:unknown})?.level;if(typeof level!=='number'||![1,2,3].includes(level))return invalid();result.attrs={level};}
  if(node.type==='orderedList'){const start=(node.attrs as {start?:unknown})?.start??1;if(typeof start!=='number'||!Number.isInteger(start)||start<1||start>10000)return invalid();result.attrs={start};}
  return result;
 }
 const document=read(input,0);if(document.type!=='doc')return invalid();return document;
}
