import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {GlobalApprovalTasks} from './global-approval-tasks';
import type {ApprovalQueuePage} from '../../../../services/business-core/src/projects/project-approval-queue';
const initial:ApprovalQueuePage={memberId:'reviewer',canReview:true,nextCursor:null,rows:[{id:'p:rfa',requestId:'rfa',projectId:'p',projectName:'Villa',title:'Wardrobe drawing',revision:'R1',status:'submitted',ownerId:'reviewer',ownerName:'Maya',dueDate:'2026-10-01',href:'/workspace/projects/p/overview?view=approvals&record=rfa'}]};
afterEach(()=>vi.unstubAllGlobals());
it('opens the exact amendment from its global review action',()=>{
 const page:ApprovalQueuePage={...initial,rows:[{...initial.rows[0],kind:'order_amendment',id:'p:amendment:a',title:'PO-1 · Boards',href:'/workspace/projects/p/procurement?record=order&amendment=a'}]};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>page}));render(<GlobalApprovalTasks workspaceId="w" initial={page}/>);
 expect(screen.getByRole('link',{name:'Review amendment'})).toHaveAttribute('href',page.rows[0].href);expect(screen.getByText('Order amendment')).toBeVisible();
});
it('opens the canonical RFA and retains the sales-task entry point',()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>initial}));render(<GlobalApprovalTasks workspaceId="w" initial={initial} showSales/>);
 expect(screen.getByRole('link',{name:'Review RFA'})).toHaveAttribute('href',initial.rows[0].href);
 expect(screen.getByRole('link',{name:'Sales tasks'})).toHaveAttribute('href','/workspace/crm/follow-ups?view=activity');
 expect(screen.queryByRole('button',{name:'Approve'})).not.toBeInTheDocument();
 expect(screen.getByRole('region',{name:'Global project approvals'})).toHaveAttribute('data-grid-lines','true');
});
it('sends full-workspace search and view selection to the server',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>initial});vi.stubGlobal('fetch',fetcher);
 render(<GlobalApprovalTasks workspaceId="w" initial={initial}/>);
 fireEvent.click(screen.getByRole('button',{name:/Table view/}));fireEvent.click(await screen.findByRole('option',{name:'Open requests'}));
 fireEvent.change(screen.getByRole('searchbox',{name:'Search projects and approvals'}),{target:{value:'Villa'}});
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('view=open&q=Villa'),expect.objectContaining({cache:'no-store'})));
});
it('keeps loaded rows when refreshing fails',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(Error('Offline')));render(<GlobalApprovalTasks workspaceId="w" initial={initial}/>);
 fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await screen.findByText('Could not refresh approvals');
 expect(screen.getByRole('link',{name:'Wardrobe drawing'})).toBeVisible();expect(screen.getByRole('button',{name:'Retry'})).toBeVisible();
});
it('ignores an older response that arrives after the search changes',async()=>{
 let resolveOld:(value:unknown)=>void=()=>{};
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValue({ok:true,json:async()=>({...initial,rows:[]})});vi.stubGlobal('fetch',fetcher);
 render(<GlobalApprovalTasks workspaceId="w" initial={initial}/>);
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
 fireEvent.change(screen.getByRole('searchbox',{name:'Search projects and approvals'}),{target:{value:'Nothing'}});
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));await screen.findByText('No matching approvals');
 resolveOld({ok:true,json:async()=>initial});await Promise.resolve();
 expect(screen.queryByRole('link',{name:'Wardrobe drawing'})).not.toBeInTheDocument();
});
it('loads another page without duplicating a request identity',async()=>{
 const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>initial});vi.stubGlobal('fetch',fetcher);
 render(<GlobalApprovalTasks workspaceId="w" initial={{...initial,nextCursor:'next'}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Load more approvals'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('cursor=next'),expect.anything()));
 expect(screen.getAllByRole('link',{name:'Wardrobe drawing'})).toHaveLength(1);
});
