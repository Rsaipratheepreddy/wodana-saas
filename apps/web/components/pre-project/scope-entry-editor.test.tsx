import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { DesignSystemProvider } from '@/design-system';
import { blankEntry, type CaseContent, type ScopeEntry } from '@/lib/pre-project/content';
import { ScopeEditor } from './scope-entry-editor';

vi.mock('../crm/note-rich-editor', () => ({ NoteRichEditor: ({document,onChange,writable}:any) => <textarea aria-label="Requirement notes" readOnly={!writable} value={document.content.content?.map((p:any)=>p.content?.map((t:any)=>t.text).join('')).join('\n') ?? ''} onChange={e=>onChange({version:1,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:e.target.value}]}]}})}/> }));
vi.mock('./case-controls', () => ({
  CaseModal: ({title, children, footer}: {title:string;children:ReactNode;footer:ReactNode}) => <section aria-label={title}>{children}{footer}</section>,
  CatalogChoiceField: ({label}: {label:string}) => <input aria-label={label}/>,
  AssetFiles: () => null,
  AssetUpload: () => <button type="button">Attach files</button>,
}));
const data = {workspaceId:'workspace',caseId:'case',canEdit:true,rooms:[{id:'room',name:'Bedroom',version:1}]} as CaseContent;
function setup(entry = blankEntry('room'), fail = false) {
  const onSave=vi.fn(async (value:ScopeEntry) => { if(fail) throw new Error('Save failed; retry.'); return {...value,version:value.version+1}; });
  const onClose=vi.fn(); const onArchive=vi.fn(async()=>{});
  render(<DesignSystemProvider><ScopeEditor entry={entry} data={data} onSave={onSave} onClose={onClose} onArchive={onArchive} onSpecifications={vi.fn()}/></DesignSystemProvider>);
  return {user:userEvent.setup(),onSave,onClose,onArchive};
}
describe('short scope capture',()=>{
 it('saves raw client words in one sheet without catalog setup',async()=>{
  const {user,onSave,onClose}=setup();
  expect(screen.queryByText('Record type')).not.toBeInTheDocument();
  expect(screen.queryByText('Link catalog records · optional')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Quantity · optional')).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Client requirement'),'More storage');
  await user.type(screen.getByLabelText('Requirement notes'),'Client said roughly 8 feet.');
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  await waitFor(()=>expect(onClose).toHaveBeenCalled());
  expect(onSave.mock.calls[0][0]).toMatchObject({title:'More storage',note:'Client said roughly 8 feet.',roomId:'room',quantity:null,scopeStatus:'undecided',reviewStatus:'captured',catalogLinks:[]});
 });
 it('keeps entered values after a failed save',async()=>{
  const {user,onSave}=setup(blankEntry('room'),true);
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a short title');
  await user.type(screen.getByLabelText('Client requirement'),'Wardrobe');
  await user.type(screen.getByLabelText('Requirement notes'),'Keep oak finish.');
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Save failed');
  expect(onSave.mock.calls[0][0]).toMatchObject({title:'Wardrobe',note:'Keep oak finish.'});
 });
 it('clears the note for repeated capture and preserves the selected room and kind',async()=>{
  const {user,onSave,onClose}=setup({...blankEntry('room'),kind:'inspiration'});
  await user.type(screen.getByLabelText('Title'),'Oak kitchen');
  await user.click(screen.getByRole('checkbox',{name:'Add another after saving'}));
  await user.click(screen.getByRole('button',{name:'Save inspiration'}));
  await waitFor(()=>expect(screen.getByLabelText('Title')).toHaveValue(''));
  expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  expect(onClose).not.toHaveBeenCalled();
  expect(onSave.mock.calls[0][0]).toMatchObject({kind:'inspiration',roomId:'room'});
 });
 it('keeps existing links and team decisions when editing only client notes',async()=>{
  const entry={...blankEntry('room'),version:4,title:'Wardrobe',quantity:72,unit:'sq.ft',reviewStatus:'reviewed',scopeStatus:'included',catalogLinks:[{role:'work',recordId:'catalog-item',snapshot:{id:'catalog-item',name:'Wardrobe',kind:'work',code:'001',version:1,catalogId:'catalog'}}]};
  const {user,onSave}=setup(entry);
  await user.type(screen.getByLabelText('Requirement notes'),'Keep the loft.');
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  expect(onSave.mock.calls[0][0]).toMatchObject({...entry,note:'Keep the loft.'});
 });
 it('keeps capture as a single note without room, pricing or record-settings controls',()=>{
  setup({...blankEntry('room'),version:1,title:'Wardrobe',source:'client'});
  expect(screen.getByLabelText('Requirement notes')).toBeVisible();
  expect(screen.queryByRole('button',{name:'Details'})).not.toBeInTheDocument();
  expect(screen.queryByText('Team decisions & record settings')).not.toBeInTheDocument();
 });
 it('routes missing document attachments to References instead of losing the title',async()=>{
  const {user,onSave}=setup({...blankEntry(),kind:'file'});
  await user.type(screen.getByLabelText('Title'),'Site sketch');
  await user.click(screen.getByRole('button',{name:'Save site plan'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Attach a site layout');
  expect(screen.getByLabelText('Requirement notes')).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
 });
 it.each([['read-only',false,null],['archived',true,'2026-09-22T00:00:00Z']] as const)('prevents %s notes from submitting changes',async(_state,canEdit,archivedAt)=>{
  const onSave=vi.fn();
  render(<DesignSystemProvider><ScopeEditor entry={{...blankEntry(),title:'Saved requirement',archivedAt}} data={{...data,canEdit}} onSave={onSave} onClose={vi.fn()} onArchive={vi.fn()} onSpecifications={vi.fn()}/></DesignSystemProvider>);
  expect(screen.getByLabelText('Client requirement')).toBeDisabled();
  expect(screen.getByLabelText('Requirement notes')).toHaveAttribute('readonly');
  expect(screen.queryByRole('button',{name:'Save requirement'})).not.toBeInTheDocument();
  fireEvent.submit(screen.getByLabelText('Client requirement').closest('form')!);
  expect(onSave).not.toHaveBeenCalled();
 });

});
