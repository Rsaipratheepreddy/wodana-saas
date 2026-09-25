import {render,screen,waitFor,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {DesignSystemProvider} from '@/design-system';
import * as content from '@/lib/pre-project/content';
import {DesignReviewModal} from './design-review-modal';
const design={id:'d',title:'Plan',scopeTitle:'Cabinets',archivedAt:null,activity:[],threads:[],versions:[{id:'v1',asset:{id:'a',name:'plan.png',mimeType:'image/png',hasPreview:true}}]} as unknown as content.CaseDesign;
const data={workspaceId:'w',caseId:'c',canEdit:true} as content.CaseContent;
const options={reviewers:[],members:[{id:'u',name:'Designer'}]} as unknown as content.DesignOptions;
beforeEach(()=>{Element.prototype.scrollTo=vi.fn();});
afterEach(()=>vi.restoreAllMocks());
it('saves an image pin and selected person against the current revision',async()=>{
 const request=vi.spyOn(content,'caseRequest').mockResolvedValue(design),update=vi.fn();
 render(<DesignSystemProvider><DesignReviewModal data={data} design={design} options={options} onClose={vi.fn()} onUpdate={update}/></DesignSystemProvider>);
 const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Add comment'}));fireEvent.click(screen.getByRole('button',{name:'Place a comment pin on the image'}),{detail:0});
 await user.type(screen.getByRole('textbox',{name:'Comment'}),'Adjust this cabinet.');
 await user.type(screen.getByRole('textbox',{name:'Comment'}),' @Des');await user.click(screen.getByRole('option',{name:'Designer'}));await user.click(screen.getByRole('button',{name:/^Post$/}));
 await waitFor(()=>expect(update).toHaveBeenCalledWith(design));
 expect(request).toHaveBeenCalledWith('w','c','designs/d/threads','POST',expect.objectContaining({versionId:'v1',anchor:{x:0.5,y:0.5},mentions:['u'],body:'Adjust this cabinet. @Designer'}));
});
it('keeps locked records view-only',()=>{
 render(<DesignSystemProvider><DesignReviewModal data={{...data,canEdit:false}} design={design} options={options} onClose={vi.fn()} onUpdate={vi.fn()}/></DesignSystemProvider>);
 expect(screen.getByText('Comments are locked for this record.')).toBeInTheDocument();expect(screen.queryByRole('textbox')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Place a comment pin on the image'})).not.toBeInTheDocument();
});
it('opens the exact historical file and keeps earlier revisions read-only',async()=>{
 const older={...design.versions[0],id:'old',number:1,asset:{...design.versions[0].asset,id:'old-asset',name:'old.png'}};
 const latest={...design.versions[0],number:2};
 render(<DesignSystemProvider><DesignReviewModal data={data} design={{...design,versions:[latest,older]}} options={options} onClose={vi.fn()} onUpdate={vi.fn()}/></DesignSystemProvider>);
 const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'R2 · Latest Revision'}));await user.click(screen.getByRole('option',{name:'R1'}));
 expect(screen.getByRole('img',{name:'old.png'})).toHaveAttribute('src',expect.stringContaining('old-asset'));
 expect(screen.getByRole('link',{name:'Download file'})).toHaveAttribute('href',expect.stringContaining('old-asset'));
 expect(screen.queryByRole('textbox',{name:'Comment'})).not.toBeInTheDocument();
 expect(screen.getByText('Earlier revision · read-only')).toBeVisible();
});
it('keeps an unsent draft on its original revision when a newer revision arrives',async()=>{
 const view=(record:content.CaseDesign)=><DesignSystemProvider><DesignReviewModal data={data} design={record} options={options} onClose={vi.fn()} onUpdate={vi.fn()}/></DesignSystemProvider>;
 const {rerender}=render(view(design));await userEvent.type(screen.getByRole('textbox',{name:'Comment'}),'Unsaved feedback');
 rerender(view({...design,versions:[{...design.versions[0],id:'v2',number:2},design.versions[0]]}));
 expect(screen.getByText('Earlier revision · read-only')).toBeVisible();
 expect(screen.getByText('Your unsent comment: Unsaved feedback')).toBeVisible();
 expect(screen.queryByRole('button',{name:'Post'})).not.toBeInTheDocument();
});
