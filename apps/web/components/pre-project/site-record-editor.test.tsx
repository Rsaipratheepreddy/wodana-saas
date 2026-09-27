import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { DesignSystemProvider } from '@/design-system';
import { type CaseContent } from '@/lib/pre-project/content';
import { newSiteRecord, type SiteData } from '@/lib/pre-project/site';
import { SiteRecordEditor } from './site-record-editor';

vi.mock('./case-controls',()=>({CaseModal:({title,children,footer}:{title:string;children:ReactNode;footer:ReactNode})=><section aria-label={title}>{children}{footer}</section>,AssetFiles:()=>null,AssetUpload:()=>null}));
const data={workspaceId:'workspace',caseId:'case',canEdit:true,rooms:[{id:'room',name:'Bedroom',version:1}],entries:[]} as unknown as CaseContent;
const site:SiteData={items:[],members:[],timezone:'Asia/Dubai',canVerify:true};
const dimension={id:'dim',name:'Width',unit:'ft',basis:'site_opening',approximate:8,measured:7.9,source:'team',evidence:'Photo reference'};
function setup(kind:'visit'|'measurement'|'observation',failure=false,readonly=false,dimensions=[dimension]){
 const initial={...newSiteRecord(kind,'Asia/Dubai','room'),title:'Bedroom survey',dimensions};
 const onSave=vi.fn(async()=>{if(failure)throw new Error('Record changed. Draft preserved.');});const onClose=vi.fn();
 render(<DesignSystemProvider><SiteRecordEditor initial={initial} data={{...data,canEdit:!readonly}} site={site} onSave={onSave} onClose={onClose}/></DesignSystemProvider>);
 return {user:userEvent.setup(),onSave,onClose};
}
describe('short Site entry steps',()=>{
 it('keeps location separate from the dimensions and preserves estimates on save',async()=>{
  const {user,onSave,onClose}=setup('measurement');
  expect(screen.queryByRole('spinbutton',{name:'Measured'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Continue'}));
  expect(screen.getByRole('spinbutton',{name:'Approximate'})).toHaveValue(8);
  await user.clear(screen.getByRole('spinbutton',{name:'Measured'}));await user.type(screen.getByRole('spinbutton',{name:'Measured'}),'7.8');
  await user.click(screen.getByRole('button',{name:'Continue'}));
  await user.type(screen.getByLabelText('Survey notes / what to recheck'),'Checked at three heights.');
  await user.click(screen.getByRole('button',{name:'Save measurements'}));
  await waitFor(()=>expect(onClose).toHaveBeenCalled());expect(onSave).toHaveBeenCalledWith(expect.objectContaining({roomId:'room',note:'Checked at three heights.',dimensions:[expect.objectContaining({approximate:8,measured:7.8,unit:'ft'})]}),0);
 });
 it('retains edited dimensions after a conflict and across steps',async()=>{
  const {user,onSave,onClose}=setup('measurement',true);
  await user.click(screen.getByRole('button',{name:'Continue'}));await user.clear(screen.getByRole('spinbutton',{name:'Measured'}));await user.type(screen.getByRole('spinbutton',{name:'Measured'}),'7.6');
  await user.click(screen.getByRole('button',{name:'Save measurements'}));expect(await screen.findByRole('alert')).toHaveTextContent('Draft preserved');expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Back'}));await user.click(screen.getByRole('button',{name:'Continue'}));expect(screen.getByRole('spinbutton',{name:'Measured'})).toHaveValue(7.6);expect(onSave).toHaveBeenCalledTimes(1);
 });
 it('saves a short observation without making an item or photo mandatory',async()=>{
  const {user,onSave}=setup('observation');await user.type(screen.getByLabelText('What did you find?'),'Uneven wall');await user.click(screen.getByRole('button',{name:'Save observation'}));expect(onSave).toHaveBeenCalledWith(expect.objectContaining({kind:'observation',note:'Uneven wall',entryId:null,assets:[]}),0);
 });
 it('saves the measured walls and skips suggested rows left blank',async()=>{
  const blank={...dimension,id:'wall-d',name:'Wall D',approximate:null,measured:null} as unknown as typeof dimension;
  const {user,onSave,onClose}=setup('measurement',false,false,[dimension,blank]);
  await user.click(screen.getByRole('button',{name:'Continue'}));
  await user.click(screen.getByRole('button',{name:'Save measurements'}));
  await waitFor(()=>expect(onClose).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({dimensions:[expect.objectContaining({id:'dim'})]}),0);
 });
 it('still asks for at least one measured dimension',async()=>{
  const blank={...dimension,approximate:null,measured:null} as unknown as typeof dimension;
  const {user,onSave}=setup('measurement',false,false,[blank]);
  await user.click(screen.getByRole('button',{name:'Continue'}));
  await user.click(screen.getByRole('button',{name:'Save measurements'}));
  expect(await screen.findByText(/Add a named dimension/)).toBeInTheDocument();expect(onSave).not.toHaveBeenCalled();
 });
 it('does not offer saving to read-only members',()=>{setup('measurement',false,true);expect(screen.queryByRole('button',{name:'Save measurements'})).not.toBeInTheDocument();expect(screen.getByLabelText('What are you measuring?')).toBeDisabled();});
});
