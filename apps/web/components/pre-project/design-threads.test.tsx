import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {DesignSystemProvider} from '@/design-system';
import * as content from '@/lib/pre-project/content';
import {DesignThreads} from './design-threads';
const revision={id:'v1',number:1,status:'draft',note:'',createdAt:'2026-09-07T00:00:00Z',createdByName:'Designer',asset:{id:'a',name:'Photo',mimeType:'image/png',byteSize:10,hasPreview:true}};
const design:content.CaseDesign={id:'d',title:'Reception',version:3,description:'',documentType:'Other',roomId:null,scopeEntryId:null,archivedAt:null,updatedAt:'2026-09-07',activity:[],versions:[revision],threads:[{id:'t',versionId:'v1',title:'Lighting',blocking:false,status:'open',version:1,createdBy:'u',createdByName:'Designer',createdAt:revision.createdAt,resolvedAt:null,resolvedByName:null,messages:[]}]};
const data={workspaceId:'w',caseId:'c',canEdit:true} as content.CaseContent;
const options={folders:[],reviewers:[],actorId:'u',canReview:false,canRecordClient:false};
afterEach(()=>vi.restoreAllMocks());
describe('design comments and inline replies',()=>{
 it('posts simple feedback against the selected revision without changing its approval state',async()=>{const request=vi.spyOn(content,'caseRequest').mockResolvedValue(design);const update=vi.fn();render(<DesignSystemProvider><DesignThreads data={data} design={design} revision={revision} options={options} onUpdate={update}/></DesignSystemProvider>);const user=userEvent.setup();await user.type(screen.getByRole('textbox',{name:'Add a comment'}),'Warm oak works for the reception.');await user.click(screen.getByRole('button',{name:'Post comment'}));await waitFor(()=>expect(update).toHaveBeenCalledWith(design));expect(request).toHaveBeenCalledWith('w','c','designs/d/activity','POST',expect.objectContaining({version:3,versionId:'v1',action:'comment',note:'Warm oak works for the reception.',decisionBy:''}));expect(screen.getByRole('textbox',{name:'Add a comment'})).toHaveValue('');});
 it('opens a reply inline and retains text when saving fails',async()=>{vi.spyOn(content,'caseRequest').mockRejectedValue(new Error('Connection unavailable.'));render(<DesignSystemProvider><DesignThreads data={data} design={design} revision={revision} options={options} onUpdate={vi.fn()}/></DesignSystemProvider>);const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Reply'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();await user.type(screen.getByRole('textbox',{name:'Your reply'}),'Check the fixture position.');await user.click(screen.getByRole('button',{name:'Post reply'}));expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable.');expect(screen.getByRole('textbox',{name:'Your reply'})).toHaveValue('Check the fixture position.');});
});
