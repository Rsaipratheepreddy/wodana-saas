import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import {GlobalWorkBoard,workLane} from './global-work-board';
import {GlobalProjectWork} from './global-project-work';
import type {WorkQueueRow} from '../../../../services/business-core/src/projects/project-work-queue';
const row:WorkQueueRow={id:'p:task:t',recordId:'t',projectId:'p',projectName:'Villa',kind:'task',title:'Build wardrobes',status:'in_progress',ownerId:'maker',ownerName:'Maya',dueDate:'2026-09-22',href:'/workspace/projects/p/production?record=t'};
afterEach(()=>vi.unstubAllGlobals());
it('reads the task board with a locked project filter',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({rows:[row],memberId:'maker',nextCursor:null})});vi.stubGlobal('fetch',fetcher);
 render(<GlobalProjectWork workspaceId="w" initial={{rows:[],memberId:'maker',nextCursor:null}} fixedProjectId="p" embedded/>);
 await waitFor(()=>expect(fetcher.mock.calls.some(([url])=>String(url).includes('projectId=p'))).toBe(true));expect(fetcher.mock.calls.some(([url])=>String(url).includes('/api/projects/task-board?')&&String(url).includes('view=all'))).toBe(true);expect(screen.getByRole('button',{name:'This project Project'})).toBeDisabled();expect(screen.queryByRole('navigation',{name:'Task sources'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'All locations Location'}));fireEvent.click(screen.getByRole('option',{name:'Factory'}));await waitFor(()=>expect(fetcher.mock.calls.at(-1)?.[0]).toContain('location=factory'));
});
it('offers keyboard movement only for execution tasks and never bypasses review',()=>{
 const move=vi.fn();render(<GlobalWorkBoard rows={[row,{...row,id:'order',kind:'order',title:'Purchase boards'},{...row,id:'review',title:'Inspect frame',status:'awaiting_inspection'}]} busy={false} error="" hasMore={false} onMoveTask={move}/>);
 fireEvent.click(screen.getByRole('button',{name:'Actions for Build wardrobes'}));fireEvent.click(screen.getByRole('menuitem',{name:'Mark blocked'}));expect(move).toHaveBeenCalledWith(row,'blocked');expect(screen.queryByRole('button',{name:'Actions for Purchase boards'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Actions for Inspect frame'})).not.toBeInTheDocument();
});
it('keeps approved purchase orders active while completed daily reviews are done',()=>{
 expect(workLane({kind:'order',status:'approved'})).toBe('active');
 expect(workLane({kind:'report',status:'approved'})).toBe('done');
 expect(workLane({kind:'task',status:'awaiting_inspection'})).toBe('review');
 expect(workLane({kind:'task',status:'on_hold'})).toBe('blocked');
});
it('shows blocked work in its own column with the reason and a resume action',()=>{
 const blocked={...row,status:'blocked',waitingFor:'Lift not booked'};
 const move=vi.fn();render(<GlobalWorkBoard rows={[blocked]} busy={false} error="" hasMore={false} onMoveTask={move}/>);
 expect(screen.getByRole('heading',{name:'Blocked'})).toBeVisible();
 expect(screen.getByRole('region',{name:'Project work Kanban'}).querySelector('[data-state="blocked"]')).toHaveTextContent('Lift not booked');
 fireEvent.click(screen.getByRole('button',{name:'Actions for Build wardrobes'}));fireEvent.click(screen.getByRole('menuitem',{name:'Resume in progress'}));
 expect(move).toHaveBeenCalledWith(blocked,'in_progress');
});
it('uses drag and drop for valid moves and routes review through progress reporting',()=>{
 const move=vi.fn(),open=vi.fn();const transfer={getData:vi.fn(()=>row.id),setData:vi.fn(),effectAllowed:'',dropEffect:''};
 render(<GlobalWorkBoard rows={[row]} busy={false} error="" hasMore={false} onMoveTask={move} onOpenTask={open}/>);
 const card=screen.getByRole('region',{name:'Project work Kanban'}).querySelector('article')!;
 const planned=screen.getByRole('heading',{name:'To do'}).closest('section')!;
 fireEvent.dragStart(card,{dataTransfer:transfer});fireEvent.dragOver(planned,{dataTransfer:transfer});fireEvent.drop(planned,{dataTransfer:transfer});
 expect(move).toHaveBeenCalledWith(row,'planned');
 const review=screen.getByRole('heading',{name:'In review'}).closest('section')!;
 fireEvent.dragStart(card,{dataTransfer:transfer});fireEvent.dragOver(review,{dataTransfer:transfer});expect(screen.getByText('Drop to report progress')).toBeVisible();fireEvent.drop(review,{dataTransfer:transfer});
 expect(open).toHaveBeenCalledWith(row,'updates');
 expect(move).toHaveBeenCalledTimes(1);
});
it('routes inspection-ready tasks to the review flow on a Done drop',()=>{
 const inspection={...row,status:'awaiting_inspection'};const open=vi.fn();const transfer={getData:vi.fn(()=>inspection.id),setData:vi.fn(),effectAllowed:'',dropEffect:''};
 render(<GlobalWorkBoard rows={[inspection]} busy={false} error="" hasMore={false} onOpenTask={open}/>);
 const card=screen.getByRole('region',{name:'Project work Kanban'}).querySelector('article')!;
 const done=screen.getByRole('heading',{name:'Done'}).closest('section')!;
 fireEvent.dragStart(card,{dataTransfer:transfer});fireEvent.dragOver(done,{dataTransfer:transfer});expect(screen.getByText('Drop to review inspection')).toBeVisible();fireEvent.drop(done,{dataTransfer:transfer});
 expect(open).toHaveBeenCalledWith(inspection,'details');
});
it('turns raw demo headings into readable card titles with separate references',()=>{
 render(<GlobalWorkBoard rows={[{...row,id:'factory',title:'Factory · Assemble walk-in dressing room',location:'factory'},{...row,id:'report',kind:'report',title:'Daily output · 2026-09-23',status:'draft'},{...row,id:'rfq',kind:'order',title:'RFQ-003 · DEMO · Quote request for delivery protection',status:'enquiry'}]} busy={false} error="" hasMore={false}/>);
 expect(screen.getByText('Assemble walk-in dressing room')).toBeVisible();
 expect(screen.getByText(/Daily progress report for 23 Sep/)).toBeVisible();
 expect(screen.getByText('Quote request for delivery protection')).toBeVisible();
 expect(screen.getByText('RFQ-003')).toBeVisible();
 expect(screen.queryByText(/DEMO · Quote request/)).not.toBeInTheDocument();
});
it('opens authoritative work and makes loaded-page limitations visible',()=>{
 render(<GlobalWorkBoard rows={[{...row,projectName:'DEMO FLOW · Palm Villa — Design to Delivery',clientName:'DEMO CLIENT · Sara Al Nuaimi',area:'Primary bedroom',location:'factory',resourceName:'Palm Living Joinery Factory'}]} busy={false} error="" hasMore/>);
 expect(screen.getByRole('link',{name:'Build wardrobes · Palm Villa'})).toHaveAttribute('href','/workspace/tasks?projectId=p&taskId=t');
 expect(screen.getByText('Palm Villa')).toBeVisible();
 expect(screen.queryByText('Sara Al Nuaimi')).not.toBeInTheDocument();
 expect(screen.queryByText('DEMO CLIENT · Sara Al Nuaimi')).not.toBeInTheDocument();
 expect(screen.queryByText('DEMO FLOW · Palm Villa — Design to Delivery')).not.toBeInTheDocument();
 expect(screen.queryByText('Primary bedroom')).not.toBeInTheDocument();
 expect(screen.queryByText('Factory')).not.toBeInTheDocument();
 expect(screen.getByText('Palm Living Joinery Factory')).toBeVisible();
 expect(screen.queryByText('Assigned to')).not.toBeInTheDocument();
 expect(screen.getByText('Maya')).toBeVisible();
 expect(screen.queryByText('Client')).not.toBeInTheDocument();
 expect(screen.getByRole('heading',{name:'In review'})).toBeVisible();
 expect(screen.getByText(/Showing loaded work/)).toBeVisible();
 expect(screen.getByRole('region',{name:'Project work Kanban'})).toHaveAttribute('tabindex','0');
});
it('opens every work type in its detail card without navigating away',()=>{
 const open=vi.fn();
 const rows=(['task','report','order','dispatch','snag','handover'] as const).map(kind=>({...row,id:kind,kind,title:`${kind} record`}));
 render(<GlobalWorkBoard rows={rows} busy={false} error="" hasMore={false} onOpenTask={open}/>);
 for(const item of rows){fireEvent.click(screen.getByRole('link',{name:`${item.title} · Villa`}));expect(open).toHaveBeenLastCalledWith(item);}
 expect(open).toHaveBeenCalledTimes(rows.length);
 expect(screen.getByRole('link',{name:'task record · Villa'})).toHaveAttribute('href','/workspace/tasks?projectId=p&taskId=t');
 expect(screen.getByRole('link',{name:'report record · Villa'})).toHaveAttribute('href',row.href);
});
it('loads a daily progress card as an in-page record, not a project redirect',async()=>{
 const report={...row,id:'p:report:r',recordId:'r',kind:'report' as const,title:'Daily output · 2026-09-24',status:'approved',href:'/workspace/projects/p/daily-progress?record=r'};
 const project={name:'Villa',members:[],resources:[],data:{tasks:[],reports:[{id:'r',date:'2026-09-24',shift:'Day',location:'factory',author:'Maya',status:'approved',entries:[],hours:8,people:2,materials:'',issues:'',tomorrow:'',evidence:'',note:'Assembly completed'}],orders:[],snags:[],handovers:[]}};
 const fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>String(url).includes('/execution?')?project:{rows:[report],memberId:'maker',nextCursor:null}}));vi.stubGlobal('fetch',fetcher);
 render(<GlobalProjectWork workspaceId="w" initial={{rows:[report],memberId:'maker',nextCursor:null}}/>);
 fireEvent.click(screen.getByRole('link',{name:/Daily progress report for 24 Sept · Villa/}));
 expect(await screen.findByText('Assembly completed')).toBeVisible();
 expect(screen.getByRole('link',{name:/Open full record in project/})).toHaveAttribute('href',report.href);
 expect(fetcher.mock.calls.some(([url])=>String(url).includes('/execution?'))).toBe(true);
});
it('shows the single Kanban board without duplicate table controls',()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({rows:[row],memberId:'maker',nextCursor:null})}));
 render(<GlobalProjectWork workspaceId="w" initial={{rows:[row],memberId:'maker',nextCursor:null}}/>);
 expect(screen.getByRole('region',{name:'Project work Kanban'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Table'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Build wardrobes · Villa'})).toBeVisible();
});
it('filters by the first five assignees and finds more people in the searchable picker',async()=>{
 const members=['Maya','Omar','Sara','Leena','Arun','Zara'].map((name,index)=>({id:`member-${index+1}`,name}));
 const initial={rows:[row],memberId:members[0].id,nextCursor:null,members};
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>initial});vi.stubGlobal('fetch',fetcher);
 render(<GlobalProjectWork workspaceId="w" initial={initial}/>);
 const refresh=screen.getByRole('button',{name:'Refresh project board'});
 const people=screen.getByRole('group',{name:'Filter tasks by assignee'});
 expect(refresh.parentElement?.contains(people)).toBe(true);
 expect(refresh.parentElement?.firstElementChild).toBe(people.parentElement);
 expect(refresh.parentElement?.previousElementSibling?.querySelector('summary')).toHaveTextContent('Filter');
 expect(people.querySelectorAll('button')).toHaveLength(5);
 fireEvent.click(screen.getByRole('button',{name:'Show tasks assigned to Maya'}));
 await waitFor(()=>expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('ownerId=member-1'));
 expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('view=all');
 expect(screen.getByRole('button',{name:'Show tasks assigned to Maya'})).toHaveAttribute('aria-pressed','true');
 fireEvent.click(screen.getByLabelText('Choose assignee'));
 fireEvent.change(screen.getByRole('searchbox',{name:'Search assignees'}),{target:{value:'Zara'}});
 expect(screen.getByRole('button',{name:'Zara'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'Omar'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Zara'}));
 await waitFor(()=>expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('ownerId=member-6'));
 expect(screen.queryByRole('link',{name:'Approvals'})).not.toBeInTheDocument();
});
it('says what a planned task is waiting for and flags overdue dates',()=>{
 render(<GlobalWorkBoard rows={[{...row,status:'planned',waitingFor:'Approved drawing',overdue:true}]} busy={false} error="" hasMore={false}/>);
 expect(screen.getByText('Waiting for: Approved drawing')).toBeVisible();
 expect(screen.getByText('Overdue')).toBeVisible();
});
