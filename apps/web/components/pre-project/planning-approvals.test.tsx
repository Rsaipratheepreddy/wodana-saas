import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '@/design-system';
import { PlanningApprovals } from './planning-approvals';
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),refresh:vi.fn()})}));
vi.mock('./pre-project-context',()=>({usePreProject:()=>({setSelected:vi.fn()})}));
vi.mock('./definition-page',()=>({DefinitionPage:()=> <button>Send for confirmation</button>}));
vi.mock('../commercial/commercial-page',()=>({CommercialPage:()=> <button>Issue quotation</button>}));
const props:any={record:{id:'case',title:'Kitchen'},search:'',content:{data:{},designOptions:{folders:[]},designs:[{id:'design',title:'Kitchen layout',versions:[{number:2,status:'internal_approved'}]},{id:'archived',title:'Old layout',archivedAt:'yesterday',versions:[]}]},definition:{definition:{current:null,draft:{readyToPublish:false}}},commercial:{data:{quotes:[{id:'quote',kind:'quotation',number:3,status:'internal_review'},{id:'old',kind:'quotation',number:1,status:'superseded'}]}}};
function show(review?:string){render(<DesignSystemProvider><PlanningApprovals {...props} review={review}/></DesignSystemProvider>);}
it('shows actual current revisions and routes reviews within the hub',async()=>{
 show();
 expect(screen.getByText('Internally approved')).toBeInTheDocument();
 expect(screen.queryByText('Old layout')).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Review Kitchen layout V2'})).toHaveAttribute('href','/workspace/pre-projects/cases/case/designs?file=design');
 expect(screen.queryByRole('link',{name:'Review Project quotation V1'})).not.toBeInTheDocument();
 await userEvent.click(screen.getByRole('button',{name:/All items Table view/}));
 await userEvent.click(screen.getByRole('option',{name:'Designs'}));
 expect(screen.queryByText('Project quotation')).not.toBeInTheDocument();
 expect(screen.getByText('Kitchen layout')).toBeInTheDocument();
});
it.each([['scope','Send for confirmation'],['quote:quote','Issue quotation']])('uses the existing review/send workflow for %s',(review,label)=>{
 show(review);expect(screen.getByRole('button',{name:label})).toBeInTheDocument();expect(screen.getByRole('link',{name:'← All approvals'})).toHaveAttribute('href','/workspace/pre-projects/cases/case/approvals');
});
it('does not substitute another record for a stale review link',()=>{show('quote:old');expect(screen.getByText('Review unavailable')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Issue quotation'})).not.toBeInTheDocument();});
