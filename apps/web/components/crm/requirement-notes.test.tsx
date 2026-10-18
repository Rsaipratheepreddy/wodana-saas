import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, afterEach, beforeAll } from 'vitest';
import { RequirementNotes, RequirementNoteEditor } from './requirement-notes';
vi.mock('next/font/google', () => ({ Caveat: () => ({ variable: 'note-font' }) }));
const note={id:'00000000-0000-4000-8000-000000000009',title:'Kitchen storage',note:'Deep drawers',version:2,archived:false};
const asset={id:'00000000-0000-4000-8000-000000000010',name:'Kitchen.png',mimeType:'image/png',byteSize:240,hasPreview:true};
beforeAll(()=>{
 Range.prototype.getBoundingClientRect=()=>({x:0,y:0,width:0,height:0,top:0,left:0,right:0,bottom:0,toJSON:()=>({})});
 Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;
 HTMLElement.prototype.scrollIntoView=()=>{};
});
afterEach(()=>vi.unstubAllGlobals());
const load=(items=[note],canEdit=true)=>{const fetcher=vi.fn().mockResolvedValue({ok:true,json:async()=>({items,canEdit})});vi.stubGlobal('fetch',fetcher);return fetcher;};
describe('Requirement notebook',()=>{
 it('retains the optional case notebook without changing its linked records',async()=>{
  const fetcher=load();render(<RequirementNotes workspaceId="workspace" caseId="case"/>);
  expect(await screen.findByRole('button',{name:'Open Kitchen storage'})).toBeVisible();
  expect(fetcher.mock.calls[0][0]).toContain('/pre-projects/case/requirement-notes');
  expect(await screen.findByRole('textbox',{name:'Requirement notes'}, {timeout: 5000})).toHaveTextContent('Deep drawers');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Save changes'})).toBeDisabled();
 });
 it('searches notes and retains an unsaved title while switching',async()=>{
  load([note,{...note,id:'00000000-0000-4000-8000-000000000012',title:'Bedroom',note:'Quiet palette'}]);render(<RequirementNotes workspaceId="workspace" caseId="case"/>);
  await screen.findByRole('textbox',{name:'Note title'});await userEvent.type(screen.getByRole('textbox',{name:'Note title'}),' revised');
  await userEvent.click(screen.getByRole('button',{name:'Open Bedroom'}));await userEvent.click(screen.getByRole('button',{name:'Open Kitchen storage revised'}));
  expect(screen.getByRole('textbox',{name:'Note title'})).toHaveValue('Kitchen storage revised');
  await userEvent.type(screen.getByRole('searchbox',{name:'Search notes'}),'Quiet');
  expect(screen.queryByRole('button',{name:'Open Kitchen storage revised'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Open Bedroom'})).toBeVisible();
 });
 it('creates an explicit draft and sends the note document and original version',async()=>{
  const fetcher=load();render(<RequirementNotes workspaceId="workspace" caseId="case"/>);await screen.findByRole('button',{name:'Open Kitchen storage'});
  await userEvent.click(screen.getByRole('button',{name:'New note'}));await userEvent.type(screen.getByRole('textbox',{name:'Note title'}),'Living room');
  fetcher.mockImplementationOnce(async(_url:string,options:RequestInit)=>({ok:true,json:async()=>({items:[note,{...JSON.parse(String(options.body)),version:1}],canEdit:true})}));
  await userEvent.click(screen.getByRole('button',{name:'Save note'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Save changes'})).toBeDisabled());
  const payload=JSON.parse(fetcher.mock.calls.at(-1)![1].body);expect(payload).toMatchObject({title:'Living room',version:0,document:{version:1,content:{type:'doc'}},archived:false});
 });
 it('keeps the draft after a conflict and retries the same version',async()=>{
  const fetcher=load();render(<RequirementNotes workspaceId="workspace" caseId="case"/>);await screen.findByRole('textbox',{name:'Note title'});await userEvent.type(screen.getByRole('textbox',{name:'Note title'}),' revised');
  fetcher.mockResolvedValue({ok:false,json:async()=>({message:'This note changed. Your draft is kept.'})});
  await userEvent.click(screen.getByRole('button',{name:'Save changes'}));await screen.findByRole('alert');
  expect(screen.getByRole('textbox',{name:'Note title'})).toHaveValue('Kitchen storage revised');
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toMatchObject({version:2,title:'Kitchen storage revised'});
 });
 it('persists pinning and offers archive/restore without deleting content',async()=>{
  const fetcher=load();render(<RequirementNotes workspaceId="workspace" caseId="case"/>);await screen.findByRole('button',{name:'Pin'});
  await userEvent.click(screen.getByRole('button',{name:'Pin'}));expect(screen.getByRole('button',{name:'Pinned'})).toHaveAttribute('aria-pressed','true');
  fetcher.mockImplementationOnce(async(_url:string,options:RequestInit)=>({ok:true,json:async()=>({items:[{...JSON.parse(String(options.body)),version:3}],canEdit:true})}));
  await userEvent.click(screen.getByRole('button',{name:'Archive'}));
  await userEvent.click(screen.getByRole('button',{name:'Archived'}));
  await screen.findByRole('button',{name:'Restore'});expect(screen.getByRole('textbox',{name:'Requirement notes'})).toHaveTextContent('Deep drawers');
  expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toMatchObject({pinned:true,archived:true,note:'Deep drawers'});
 });
 it('shows existing content read-only without editor actions',async()=>{
  load([note],false);render(<RequirementNotes workspaceId="workspace" caseId="case"/>);
  expect(await screen.findByRole('textbox',{name:'Requirement notes'}, {timeout: 5000})).toHaveAttribute('contenteditable','false');
  expect(screen.queryByRole('button',{name:'New note'})).not.toBeInTheDocument();expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
 });
 it('renders legacy images and links inline through authenticated URLs',async()=>{
  render(<RequirementNoteEditor note={{...note,assets:[asset],links:['https://example.com/']}} canEdit={false} onClose={vi.fn()} onSave={vi.fn()} assetUrl={()=>'/private/image'}/>);
  expect(await screen.findByRole('img',{name:'Kitchen.png'})).toHaveAttribute('src','/private/image');
  expect(screen.getByRole('link',{name:'https://example.com/'})).toHaveAttribute('rel','noopener noreferrer');
 });
 it('keeps successful uploads when another file fails',async()=>{
  const upload=vi.fn().mockResolvedValueOnce(asset).mockRejectedValueOnce(new Error('Network unavailable'));const save=vi.fn().mockResolvedValue(undefined);
  render(<RequirementNoteEditor note={note} canEdit onClose={vi.fn()} onSave={save} onUpload={upload} assetUrl={()=>'/private/image'}/>);
  await screen.findByRole('textbox',{name:'Requirement notes'}, {timeout: 5000});
  await userEvent.upload(screen.getByLabelText('Attach reference files'),[new File(['png'],'Kitchen.png',{type:'image/png'}),new File(['pdf'],'Plan.pdf',{type:'application/pdf'})]);
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable'));
  expect(screen.getByRole('img',{name:'Kitchen.png'})).toBeInTheDocument();await userEvent.click(screen.getByRole('button',{name:'Save changes'}));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({assets:[asset],document:expect.objectContaining({version:1})}));
 });
});
