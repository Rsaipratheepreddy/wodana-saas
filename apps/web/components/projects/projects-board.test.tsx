import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi, afterEach, beforeEach } from "vitest";
import { ProjectsBoard, projectCards } from "./projects-board";
import type { PreProjectListItem } from "@/lib/pre-project/types";
import type { PortfolioRow } from "./project-portfolio";
const push=vi.fn();
const navigation=vi.hoisted(()=>({query:'view=production'}));
vi.mock("next/navigation",()=>({useRouter:()=>({push,refresh:vi.fn()}),useSearchParams:()=>new URLSearchParams(navigation.query)}));
beforeEach(()=>{navigation.query='view=production';});
afterEach(()=>vi.unstubAllGlobals());
const planning={id:"case-1",title:"Villa interiors",customerName:"Amira",status:"active",phase:"design",leadManagerName:"Owner"} as PreProjectListItem;
const project={id:"project-1",caseId:"case-1",name:"Villa interiors",customer:"Amira",phase:"active",manager:"Owner",team:["Owner","Designer"],onHold:false} as PortfolioRow;
it("deduplicates linked cases and maps planning, production, handover and delivered stages",()=>{
 const cards=projectCards([project,{...project,id:"project-2",caseId:"case-2",phase:"handover"},{...project,id:"project-3",caseId:"case-3",phase:"completed"}],[planning]);
 expect(cards).toHaveLength(3);expect(cards.map(card=>card.stage)).toEqual(["production","handover","delivered"]);
 expect(cards[0].href).toBe("/workspace/projects/project-1/overview?projectName=Villa+interiors");
 expect(projectCards([], [planning])[0].stage).toBe("planning");
 expect(projectCards([{...project,team:undefined}],[])[0].team).toEqual(["Owner"]);
});
it("keeps unpaid Palm preparation in Sales and the paid Deal project in Planning until procurement",()=>{
 const beforePayment={...planning,id:'unpaid-case',title:'Unpaid preparation',projectId:null};
 const paid={...project,reference:'PRJ-0007',workflow:{templateCode:'palm_design_build_delivery',currentStageKey:'site_visit',currentStageName:'Site visit & scope'}};
 expect(projectCards([], [beforePayment], true)).toEqual([]);
 expect(projectCards([paid], [planning,beforePayment], true)).toMatchObject([{stage:'planning',step:'Site visit & scope'}]);
 expect(projectCards([{...paid,workflow:{...paid.workflow,currentStageKey:'procurement',currentStageName:'Procurement'}}], [], true)[0].stage).toBe('production');
 navigation.query='';
 render(<ProjectsBoard projects={[paid]} planning={{workspaceId:'workspace',items:[planning,beforePayment],total:2,canCreate:true}} palmFlowEnabled/>);
 expect(screen.getByRole('link',{name:'Villa interiors'})).toHaveAttribute('href','/workspace/projects/project-1/overview?projectName=Villa+interiors');
 expect(screen.getByText('PRJ-0007')).toBeVisible();
 expect(screen.queryByText('Unpaid preparation')).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Start project'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Open Sales preparation'})).toHaveAttribute('href','/workspace/crm/preparation');
});
it("shows project details with stage and status, with the project name opening its detail page",()=>{
 render(<ProjectsBoard projects={[project]} planning={{workspaceId:'workspace',items:[planning],total:1,canCreate:true}}/>);
 expect(screen.getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual(['Project','Client','Owner','Teams','Stage','Status']);
 expect(screen.getByRole('link',{name:'Villa interiors'})).toHaveAttribute('href','/workspace/projects/project-1/overview?projectName=Villa+interiors');
 expect(screen.getByRole('link',{name:'Villa interiors'}).querySelector('svg')).toBeInTheDocument();
 expect(screen.getByRole('row',{name:/Villa interiors.*Amira Owner.*2 members Production In progress/})).toBeInTheDocument();
 expect(screen.getAllByRole('img',{name:'Owner'})).toHaveLength(2);
 expect(screen.getByRole('group',{name:'Team for Villa interiors'})).toBeInTheDocument();
 expect(screen.getByText('In progress',{selector:'[data-status]'})).toHaveAttribute('data-status','production');
 expect(screen.getByText('Production',{selector:'[data-stage]'})).toHaveAttribute('data-stage','production');
});

it('splits planning and production without losing the source planning link',()=>{
 navigation.query='';
 const other={...planning,id:'case-2',title:'Planning only'};
 const view=render(<ProjectsBoard projects={[project]} planning={{workspaceId:'workspace',items:[planning,other],total:2,canCreate:true}}/>);
 expect(screen.getByRole('link',{name:'Planning only'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Villa interiors'})).not.toBeInTheDocument();
 navigation.query='view=production';
 view.rerender(<ProjectsBoard projects={[project]} planning={{workspaceId:'workspace',items:[planning,other],total:2,canCreate:true}}/>);
 expect(screen.queryByRole('link',{name:'Planning only'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Planning'})).toHaveAttribute('href','/workspace/pre-projects/cases/case-1/requirements');
 expect(screen.getByRole('link',{name:'Production'})).toHaveAttribute('href','/workspace/projects/project-1/overview');
});
it("highlights handover, delivered and on-hold statuses",()=>{
 render(<ProjectsBoard projects={[{...project,id:'handover',caseId:'case-2',phase:'handover'},{...project,id:'delivered',caseId:'case-3',phase:'completed'},{...project,id:'held',caseId:'case-4',onHold:true}]} planning={{workspaceId:'workspace',items:[],total:0,canCreate:true}}/>);
 expect(screen.getByText('Awaiting handover',{selector:'[data-status]'})).toHaveAttribute('data-status','handover');
 expect(screen.getByText('Complete',{selector:'[data-status]'})).toHaveAttribute('data-status','delivered');
 expect(screen.getByText('On hold',{selector:'[data-status]'})).toHaveAttribute('data-status','hold');
 expect(screen.getByRole('row',{name:/Handover Awaiting handover/})).toBeInTheDocument();
 expect(screen.getByRole('row',{name:/Delivered Complete/})).toBeInTheDocument();
});
it("opens qualified client work through the connected case endpoint",async()=>{
 navigation.query='view=planning';
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({id:"saved-case"})});vi.stubGlobal("fetch",fetcher);
 render(<ProjectsBoard projects={[]} planning={{workspaceId:"workspace",items:[{...planning,qualifiedLead:true,status:"qualified",opportunityId:"deal-1"}],total:1,canCreate:true}}/>);
 await userEvent.click(screen.getByRole("button",{name:"Villa interiors"}));
 await waitFor(()=>expect(push).toHaveBeenCalledWith("/workspace/pre-projects/cases/saved-case/requirements"));
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({opportunityId:"deal-1"});
});

it("keeps planning-only work accessible from the project name",()=>{
 navigation.query='view=planning';
 render(<ProjectsBoard projects={[]} planning={{workspaceId:"workspace",items:[planning],total:1,canCreate:true}}/>);
 expect(screen.getByRole("link",{name:"Villa interiors"})).toHaveAttribute("href","/workspace/pre-projects/cases/case-1/requirements");
 expect(screen.getByText('Planning',{selector:'[data-stage]'})).toBeInTheDocument();
 expect(screen.getByText('Design',{selector:'[data-status]'})).toBeInTheDocument();
 expect(screen.queryByRole("columnheader",{name:"Planning"})).toBeNull();
 expect(screen.queryByRole("columnheader",{name:"Production"})).toBeNull();
 expect(screen.queryByRole("columnheader",{name:"Deliveries"})).toBeNull();
});
it('starts project planning from an eligible opportunity at Requirements',async()=>{
 navigation.query='view=planning';
 const fetcher=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({items:[{id:'opportunity-1',title:'Villa fitout',customerName:'Amira',status:'open',caseId:null}]})}).mockResolvedValueOnce({ok:true,json:async()=>({id:'new-case'})});vi.stubGlobal('fetch',fetcher);
 render(<ProjectsBoard projects={[]} planning={{workspaceId:'workspace',items:[],total:0,canCreate:true}}/>);
 await userEvent.click(screen.getByRole('button',{name:'Start project'}));
 expect(await screen.findByRole('dialog',{name:'Start project planning'})).toBeVisible();
 await userEvent.click(screen.getByRole('button',{name:'Choose an opportunity Opportunity'}));
 await userEvent.click(screen.getByRole('option',{name:'Villa fitout · Amira'}));
 await userEvent.click(screen.getByRole('button',{name:'Start with requirements'}));
 await waitFor(()=>expect(push).toHaveBeenCalledWith('/workspace/pre-projects/cases/new-case/requirements'));
 expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({opportunityId:'opportunity-1'});
});
it('explains missing permissions without pretending creation succeeded',async()=>{
 navigation.query='view=planning';
 render(<ProjectsBoard projects={[]} planning={{workspaceId:'workspace',items:[],total:0,canCreate:false}}/>);
 await userEvent.click(screen.getByRole('button',{name:'Start project'}));
 expect(screen.getByText(/needs Pre-execution create and Opportunities view permissions/)).toBeVisible();
 expect(screen.queryByRole('button',{name:'Start with requirements'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'New enquiry'})).toHaveAttribute('href','/workspace/crm/leads?create=true');
});
it('searches beyond the first eligible opportunities and shows a recoverable API error',async()=>{
 navigation.query='view=planning';
 const fetcher=vi.fn().mockResolvedValueOnce({ok:false,json:async()=>({message:'Opportunity lookup unavailable'})}).mockResolvedValueOnce({ok:true,json:async()=>({items:[{id:'opportunity-2',title:'Office fitout',customerName:'Daniel',status:'open',caseId:null}]})});vi.stubGlobal('fetch',fetcher);
 render(<ProjectsBoard projects={[]} planning={{workspaceId:'workspace',items:[],total:0,canCreate:true}}/>);
 await userEvent.click(screen.getByRole('button',{name:'Start project'}));
 expect(await screen.findByText('Opportunity lookup unavailable')).toBeVisible();
 await userEvent.type(screen.getByRole('searchbox',{name:'Search opportunities'}),'Office');
 await userEvent.click(screen.getByRole('button',{name:'Find'}));
 expect(await screen.findByRole('button',{name:'Choose an opportunity Opportunity'})).toBeVisible();
 expect(fetcher.mock.calls[1][0]).toContain('search=Office');
});
it('does not misreport an unavailable planning list as a permissions denial',async()=>{
 navigation.query='view=planning';
 render(<ProjectsBoard projects={[]} planning={{workspaceId:'workspace',items:[],total:0,canCreate:false,error:'Planning service unavailable'}}/>);
 await userEvent.click(screen.getByRole('button',{name:'Start project'}));
 expect(screen.getAllByText('Planning service unavailable').length).toBeGreaterThan(0);
 expect(screen.queryByText(/needs Pre-execution create and Opportunities view permissions/)).not.toBeInTheDocument();
});
