'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import type {Quote} from '@/lib/commercial/types';
import {money,quoteTotals,paymentMilestoneAmounts} from '@/lib/commercial/client';
import {quotationDescription,quotationDimensionsText} from '@/lib/commercial/presentation';
import s from './quotation-linked-block.module.css';
import {useDesignSystem} from '@/design-system';
import {Fragment, useContext} from 'react';
import {ProposalColumnsContext, ProposalFactsContext} from '@/lib/commercial/proposal-columns';
import {referenceItemGroups} from '@/lib/commercial/quotation-reference-template';
export function QuotationLinkedBlock({id,quote}:{id:string;quote:Quote}){
  const t = useT();
 const {locale}=useDesignSystem();
 const extra=useContext(ProposalColumnsContext);
 const facts=useContext(ProposalFactsContext);
 // Inside the quote editor every amount comes from the pricing engine; elsewhere the older sums apply.
 const own=quoteTotals(quote);
 const totals=facts?{subtotal:Number(facts.subtotal),tax:Number(facts.tax),total:Number(facts.total)}:own;
 const discount=facts?Number(facts.discount):quote.discount;
 const net=facts?Number(facts.net):Math.max(0,own.subtotal-quote.discount);
 const lineAmount=(line:{id:string;quantity:number;rate:number})=>facts?.lineAmount[line.id]!==undefined?Number(facts.lineAmount[line.id]):line.quantity*line.rate;
 const stored=quote.presentation?.details??{};
 // The reference the app generated before is replaced by the quote's own (Q-1 · R1); anything typed stays.
 const generated=(value?:string)=>!value||/^QT-[0-9A-F]{8} · Rev \d+$/.test(value);
 const details={...stored,
  reference:generated(stored.reference)?(facts?.reference??stored.reference):stored.reference,
  date:stored.date||facts?.date||'',
  clientPhone:stored.clientPhone||facts?.phone||'', clientEmail:stored.clientEmail||facts?.email||'',
  location:stored.location||facts?.address||'', manager:stored.manager||facts?.approvedBy||''};
 // The firm's own logo (or its name, set large, when it has none) — never another firm's artwork.
 if(id==='data:company-logo')return details.companyLogo?<img className={s.companyLogo} src={details.companyLogo} alt={details.companyName||''}/>:<div className={s.companyName}>{details.companyName}</div>;
 if(id==='data:cover-client')return <div className={s.coverClient}>{t("Client: {name}",{name:details.clientName||quote.cover?.preparedFor||''})}<br/>{t("Quote No: {reference}",{reference:details.reference??''})}</div>;
 if(id==='data:client-logo')return details.clientLogo?<img className={s.logo} src={details.clientLogo} alt={t("Client logo")}/>:null;
 if(id==='data:prepared-by')return <>{details.preparedBy}<br/>{details.companyName}</>;
 if(id==='data:issued-date')return <>{t("Date: {date}",{date:details.date})}</>;
 if(id==='data:validity')return <>{quote.validUntil?t("This quotation is valid until {date}. Payment terms follow the agreed payment schedule.",{date:facts?.validUntil||quote.validUntil.slice(0,10)}):t("Payment terms follow the agreed payment schedule.")}</>;
 if(id==='data:project-details')return <>{t("Project: {name}",{name:details.projectName||quote.title})}{details.location?<><br/>{t("Location: {location}",{location:details.location})}</>:null}</>;
 if(id==='data:estimate')return <>{t("The total estimated amount is {amount} exclusive of tax. For your convenience, we have attached a detailed breakdown.",{amount:money(net,quote.currency,locale)})}</>;
 if(id==='data:proposal-totals')return <div className={s.proposalTotals}>{[[t('SUB TOTAL'),totals.subtotal],[t('LESS DISCOUNT'),discount],[t('NET AMOUNT'),net],[t('{tax} {rate}%',{tax:(quote.cover?.taxLabel||t('Tax')).toUpperCase(),rate:quote.taxRate}),totals.tax],[t('TOTAL AMOUNT'),totals.total]].map(([label,value],index)=><div key={index}><span>{label}:</span><span>{money(Number(value),quote.currency,locale)}</span></div>)}</div>;
 if(id==='data:item-letterhead')return <div className={s.letterhead}><div className={s.letterheadBrand}>{details.companyLogo?<img src={details.companyLogo} alt={details.companyName||''}/>:details.companyName}{details.clientLogo&&<img src={details.clientLogo} alt={t("Client logo")}/>}</div><div className={s.letterheadColumns}><div>{t("Client Full Name: {value}",{value:details.clientName??''})}<br/>{t("Contact Number: {value}",{value:details.clientPhone||'—'})}<br/>{t("Delivery Address: {value}",{value:details.location||'—'})}<br/>{t("Email Address: {value}",{value:details.clientEmail||'—'})}<br/>{t("Project Name: {value}",{value:details.projectName??''})}</div><div>{t("Interior Designer / Sales: {value}",{value:details.preparedBy||'—'})}<br/>{t("Estimator: {value}",{value:details.estimator||'—'})}<br/>{t("Manager Approval: {value}",{value:details.manager||'—'})}</div><div>{t("Ref. Estimate Number: {value}",{value:details.reference??''})}<br/>{t("Date: {date}",{date:details.date})}</div></div></div>;
 if(id.startsWith('data:reference-items:')){
  const start=Number(id.slice('data:reference-items:'.length))||0,count=referenceItemGroups(quote.lines).find(group=>group.start===start)?.count??7,lines=quote.lines.slice(start,start+count);
  // The columns: the firm's schedule, with its own client-visible columns before the quantity. Widths share the page, so more columns means narrower ones (and smaller type past ten).
  const schedule:[string,number,(line:typeof lines[number],index:number)=>React.ReactNode][]=[
   [t('SN'),4,(_line,index)=>start+index+1],
   [t('DESCRIPTION OF ITEM'),19,line=><>{line.title}{line.description&&<small>{line.description}</small>}{line.optional&&<small>{t("Optional · not included")}</small>}</>],
   [t('INSPO PICTURE'),23,line=>line.photo?<img src={line.photo} alt={line.title}/>:<span className={s.noImage}>{t("Image not supplied")}</span>],
   ...(['length','height','depth'] as const).map((key):[string,number,(line:typeof lines[number])=>React.ReactNode]=>[t(key==='length'?'LENGTH':key==='height'?'HEIGHT':'DEPTH'),6,line=><>{line.dimensions?.[key]??'—'}{line.dimensions?.[key]!==undefined&&<small>{line.dimensions.unit}</small>}</>]),
   [t('MATERIALS REQUESTED'),16,line=>quotationDescription(line)||'—'],
   ...extra.map((column):[string,number,(line:typeof lines[number])=>React.ReactNode]=>[column.name.toUpperCase(),10,line=>(line as {values?:Record<string,string>}).values?.[column.id]||'—']),
   [t('QTY'),6,line=><>{line.quantity}{line.unit&&<small>{line.unit}</small>}</>],
   [t('UNIT PRICE'),8,line=>money(line.rate,quote.currency,locale)],
   [t('TOTAL AMOUNT'),8,line=>money(lineAmount(line),quote.currency,locale)],
  ];
  const weight=schedule.reduce((sum,[,share])=>sum+share,0);
  return <div className={s.referenceSchedule} data-dense={schedule.length>10||undefined}><table><colgroup>{schedule.map(([,share],index)=><col key={index} style={{width:`${(share/weight*100).toFixed(2)}%`}}/>)}</colgroup><thead style={{display:start?'none':undefined}}><tr>{schedule.map(([label],index)=><th key={index}>{label}</th>)}</tr></thead><tbody>{lines.map((line,index)=><Fragment key={line.id}>{(index===0||lines[index-1].room!==line.room)&&<tr className={s.room}><td colSpan={schedule.length}>{line.room}</td></tr>}<tr className={s.referenceItem}>{schedule.map(([,,cell],column)=><td key={column}>{cell(line,index)}</td>)}</tr></Fragment>)}</tbody></table>{!lines.length&&<p className={s.empty}>{t("Add items in Scope & Items to populate this schedule.")}</p>}{start+count>=quote.lines.length&&<><div className={s.referenceTotals}><QuotationLinkedBlock id="data:proposal-totals" quote={quote}/></div><p className={s.note}>{t("NOTE: Any changes to the items quoted may result in price variation adjustments.")}</p></>}</div>;
 }
 if(id==='data:summary')return <div className={s.summary}>{[[t('Subtotal'),totals.subtotal],[t('Discount'),discount],[t('Tax'),totals.tax],[t('Total'),totals.total]].map(([label,value])=><div key={label}><span>{label}</span><strong>{money(Number(value),quote.currency,locale)}</strong></div>)}</div>;
 if(id==='data:payments'&&!quote.paymentTerms.length)return <p>{t("No payment milestones yet. Use Edit payment schedule to add them.")}</p>;
 if(id==='data:payments')return <table className={s.table}><thead><tr><th>{t("Milestone")}</th><th>%</th><th>{t("Amount")}</th></tr></thead><tbody>{quote.paymentTerms.map((term,index)=><tr key={index}><td>{term.title}</td><td>{term.percent}%</td><td>{money(paymentMilestoneAmounts(totals.total,quote.paymentTerms)[index],quote.currency,locale)}</td></tr>)}</tbody></table>;
 if(id.startsWith('data:items:')){const start=Number(id.slice('data:items:'.length))||0;const lines=quote.lines.slice(start,start+3);const config=quote.presentation?.scopeColumns;const columns=[{id:'image',label:t('Image')},{id:'item',label:t('Item')},{id:'description',label:t('Description')},{id:'dimensions',label:t('Dimensions')},{id:'quantity',label:t('Qty')},{id:'unit',label:t('Unit')},{id:'rate',label:t('Rate')},{id:'amount',label:t('Amount')}].filter(column=>!config?.hidden.includes(column.id));return <><table className={s.table}><thead><tr>{columns.map(column=><th key={column.id}>{column.label}</th>)}{config?.custom.map(column=><th key={column.id}>{column.name}</th>)}</tr></thead><tbody>{lines.map(line=><tr key={line.id}>{columns.map(column=><td key={column.id}>{column.id==='image'?(line.photo?<img src={line.photo} alt={line.title}/>:null):column.id==='item'?<><strong>{line.title}</strong><small>{line.room}</small></>:column.id==='description'?quotationDescription(line):column.id==='dimensions'?quotationDimensionsText(line.dimensions):column.id==='quantity'?line.quantity:column.id==='unit'?line.unit:column.id==='rate'?money(line.rate,quote.currency,locale):money(line.quantity*line.rate,quote.currency,locale)}</td>)}{config?.custom.map(column=><td key={column.id}>{column.values[line.id]}</td>)}</tr>)}</tbody></table>{start+3>=quote.lines.length&&<div className={s.scopeTotals}><span>{t("Subtotal")}{" "}{money(totals.subtotal,quote.currency,locale)}</span><span>{t("Discount")}{" "}{money(quote.discount,quote.currency,locale)}</span>{quote.taxRate>0&&<span>{t("Tax")}{" "}{money(totals.tax,quote.currency,locale)}</span>}<strong>{t("Total")}{" "}{money(totals.total,quote.currency,locale)}</strong></div>}</>;}return null;
}
