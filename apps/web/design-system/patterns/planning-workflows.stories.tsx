import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AgreementPayments, ApprovalRelease, CommercialRequests } from '@/components/commercial/commercial-workflows';
import commercialStyles from '@/components/commercial/commercial.module.css';
import type { CommercialState } from '@/lib/commercial/types';

// Isolated visual-QC data. This story never writes project or accounting records.
const state: CommercialState = {
  workspaceId:'visual-qc',caseId:'visual-qc',title:'Planning UI fixture',customerName:'Test client',currency:'AED',contacts:[],
  canEdit:true,canApprove:true,canVerifyFinance:true,canRelease:true,canManagePortal:false,portalSlug:null,
  releaseReadiness:{designsRequired:1,designsApproved:0},
  data:{revision:1,quotes:[{id:'quote',number:1,kind:'quotation',status:'accepted',title:'Kitchen scope',currency:'AED',validUntil:'2026-12-31',discount:0,taxRate:0,terms:'Approved scope only.',exclusions:'',requestIds:[],createdAt:'2026-09-22',total:10000,paymentTerms:[],lines:[]}],
    agreement:{quoteId:'quote',reference:'QC-AGR-001',terms:'Approved scope only.',evidence:'',status:'draft'},
    payments:[{id:'advance',sourceQuoteId:'quote',title:'Advance',amount:4000,dueDate:'2026-10-01',requiredForRelease:true,status:'pending',reference:'',proof:''},{id:'handover',sourceQuoteId:'quote',title:'Handover',amount:6000,dueDate:'2026-11-01',requiredForRelease:false,status:'pending',reference:'',proof:''}],
    requests:[],audit:[],release:null},
};
function Example({view}:{view:'agreement'|'payments'|'release'|'changes'}) {
 const [action,setAction]=useState('');
 const run=async(name:string)=>{setAction(`Test action: ${name}. No server request was sent.`);return false;};
 return <main className={commercialStyles.page} style={{background:'#fff',color:'#202422',minHeight:'100vh',padding:20}}>
  <p style={{fontSize:12,color:'#68716b',margin:'0 0 16px'}}>UI test fixture · no live client or accounting records</p>
  {action&&<p role="status">{action}</p>}
  {view==='release'?<ApprovalRelease state={state} run={run} busy={false} root="/visual-qc"/>:view==='changes'?<CommercialRequests state={state} run={run} busy={false}/>:<AgreementPayments state={state} initialView={view} run={run} busy={false}/>}
 </main>;
}
const meta={title:'Planning/Commercial workflows',component:Example,parameters:{layout:'fullscreen'}} satisfies Meta<typeof Example>;
export default meta;
type Story=StoryObj<typeof meta>;
export const Agreement:Story={args:{view:'agreement'}};
export const Payments:Story={args:{view:'payments'}};
export const Release:Story={args:{view:'release'}};
export const Changes:Story={args:{view:'changes'}};
