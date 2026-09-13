import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DesignSystemProvider } from '@/design-system';
import { blankEntry, blankSpecification, briefFields, type CaseContent, type ScopeEntry } from '@/lib/pre-project/content';
import { ScopeNoteCards } from './scope-note-cards';
import { BriefScopePage } from './brief-scope-page';
vi.mock('next/font/google',()=>({Caveat:()=>({variable:'note-font'})}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams(),useRouter:()=>({push:vi.fn()})}));
beforeEach(()=>vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({items:[],canEdit:true})})));
afterEach(()=>vi.unstubAllGlobals());
const entry:ScopeEntry={...blankEntry(),id:'entry',version:1,title:'Reception desk',roomName:'Reception',note:'Sample data for testing — Warm oak finish.',quantity:1,unit:'nos',specification:{...blankSpecification(),version:1,dimensions:[{id:'width',name:'Width',unit:'mm',approximate:2400,measured:2385,basis:'site_opening',source:'client',evidence:'Client sketch'}]}};
function cardSetup(value=entry,measurements=false){
 const onOpen=vi.fn();const onSpecifications=vi.fn();
 render(<DesignSystemProvider><ScopeNoteCards entries={[value]} workspaceId="workspace" caseId="case" locale="en-IN" canEdit emptyTitle="Empty" emptyDescription="Add an item" measurements={measurements} onOpen={onOpen} onSpecifications={onSpecifications}/></DesignSystemProvider>);
 return {user:userEvent.setup(),onOpen,onSpecifications};
}
describe('client note cards',()=>{
 it('opens the same record and keeps measurement actions separate',async()=>{
  const {user,onOpen,onSpecifications}=cardSetup();
  await user.click(screen.getByRole('button',{name:'Open Reception desk'}));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(entry);
  await user.click(screen.getByRole('button',{name:'Edit measurements for Reception desk'}));
  expect(onSpecifications).toHaveBeenCalledExactlyOnceWith(entry,'dimensions');
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Sample')).toBeVisible();
  expect(screen.getByText('Warm oak finish.')).toBeVisible();
  expect(entry.note).toBe('Sample data for testing — Warm oak finish.');
 });
 it('displays both stored measurements, their units and verification state without converting values',()=>{
  cardSetup(entry,true);
  const card=screen.getByRole('article',{name:'Reception desk'});
  expect(within(card).getByText('2400')).toHaveTextContent('2400 mm');
  expect(within(card).getByText('2385')).toHaveTextContent('2385 mm');
  expect(within(card).getByText('Site opening')).toBeVisible();
  expect(within(card).getByText('Measured values await verification')).toBeVisible();
 });
 it('uses a private image preview even when the first attachment is a PDF',()=>{
  cardSetup({...entry,assets:[{id:'pdf',name:'Brief.pdf',mimeType:'application/pdf',byteSize:100,hasPreview:false},{id:'photo',name:'Client reference.jpg',mimeType:'image/jpeg',byteSize:100,hasPreview:true}]});
  expect(screen.getByRole('img',{name:'Client reference.jpg'})).toHaveAttribute('src','/api/workspace/pre-projects/case/assets/photo?preview=1&workspaceId=workspace');
  expect(screen.getByText('2 files')).toBeVisible();
 });

});

const gatheringData:CaseContent={workspaceId:'workspace',caseId:'case',canEdit:true,caseStatus:'active',fromCrm:false,crmContext:{description:null,opportunityAmount:null,currencyCode:'AED'},rooms:[],entries:[entry],brief:{...(Object.fromEntries(Object.keys(briefFields).map(k=>[k,''])) as Record<keyof typeof briefFields,string>),currencyCode:'AED',budgetAmount:'',version:0}};
const linkedNote={id:'entry',version:2,title:'Kitchen storage',note:'Deep drawers',archived:false,assets:[{id:'photo',name:'Kitchen.png',mimeType:'image/png',byteSize:240,hasPreview:true}],links:['https://example.com/plan']};
describe('Requirements tabs and original forms', () => {
 it('adds a measurement from the top button and preserves existing dimensions',async()=>{
  vi.mocked(fetch).mockImplementation(async(url,init)=>({ok:true,json:async()=>String(url).includes('/specifications/')?{...blankSpecification(),...JSON.parse(String(init?.body)),version:2}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view="measurements"/></DesignSystemProvider>);
  await waitFor(()=>expect(screen.queryByText('Loading requirements…')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button',{name:'Add measurement'}));
  const dialog=screen.getByRole('dialog',{name:'Add measurement'});
  await user.type(within(dialog).getByRole('textbox',{name:'Dimension name'}),'Height');
  await user.type(within(dialog).getByRole('spinbutton',{name:'Actual size'}),'2750');
  await user.type(within(dialog).getByRole('textbox',{name:'Measurement source'}),'Site laser measurement');
  await user.click(within(dialog).getByRole('button',{name:'Save measurement'}));
  expect(await screen.findByText('Measurement saved.')).toBeVisible();
  const call=vi.mocked(fetch).mock.calls.find(([url,init])=>String(url).includes('/specifications/entry')&&init?.method==='PUT')!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({version:1,dimensions:[{id:'width',name:'Width',measured:2385,approximate:2400},{name:'Height',measured:2750,unit:'mm',evidence:'Site laser measurement'}]});
  expect(within(screen.getByRole('article',{name:'Reception desk'})).getByText('2750')).toHaveTextContent('2750 mm');
 });
 it('retains the entered measurement when saving fails',async()=>{
  vi.mocked(fetch).mockImplementation(async(url)=>({ok:!String(url).includes('/specifications/'),json:async()=>String(url).includes('/specifications/')?{message:'This measurement changed. Reopen the latest record.'}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view="measurements"/></DesignSystemProvider>);
  await user.click(screen.getByRole('button',{name:'Add measurement'}));
  await user.type(screen.getByRole('textbox',{name:'Dimension name'}),'Height');
  await user.type(screen.getByRole('spinbutton',{name:'Actual size'}),'2750');
  await user.type(screen.getByRole('textbox',{name:'Measurement source'}),'Site photo');
  await user.click(screen.getByRole('button',{name:'Save measurement'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('This measurement changed');
  expect(screen.getByRole('spinbutton',{name:'Actual size'})).toHaveValue(2750);
  expect(screen.getByRole('textbox',{name:'Dimension name'})).toHaveValue('Height');
 });
 it('offers Add measurement even when the case has no requirements and continues after creating one',async()=>{
  vi.mocked(fetch).mockImplementation(async(url,init)=>({ok:true,json:async()=>init?.method==='PUT'?{...blankEntry(),...JSON.parse(String(init.body)),version:1,assets:[],catalogLinks:[]}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,entries:[]}} view="measurements"/></DesignSystemProvider>);
  await user.click(screen.getByRole('button',{name:'Add measurement'}));
  await user.click(within(screen.getByRole('dialog',{name:'Add measurement'})).getByRole('button',{name:'Add requirement'}));
  await user.type(screen.getByRole('textbox',{name:'Client requirement'}),'Kitchen wall');
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  expect(await screen.findByRole('dialog',{name:'Add measurement'})).toBeVisible();
  expect(screen.getByRole('textbox',{name:'Dimension name'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Whole project · Kitchen wall Requirement'})).toBeVisible();
 });
 it('uses the old cards for site plans as well as requirements',async()=>{
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,entries:[{...entry,kind:'file',title:'Ground floor plan'}]}} view="file"/></DesignSystemProvider>);
  expect(screen.getByRole('article',{name:'Ground floor plan'})).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
 });
 it('keeps client inspirations outside the three gathering tabs', () => {
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view="inspiration"/></DesignSystemProvider>);
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name:'Add inspiration'})).toBeVisible();
 });
 it('opens cards by default and switches between the three tabs', async () => {
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData}/></DesignSystemProvider>);
  expect(screen.getAllByRole('tab').map(tab=>tab.textContent)).toEqual(['Requirements','Measurements','Site plan']);
  expect(screen.getByRole('tabpanel',{name:'Requirements'})).toBeVisible();
  expect(screen.getByRole('article',{name:'Reception desk'})).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Cards view'})).toHaveAttribute('aria-pressed','true');
  expect(screen.queryByText('Capture the site room by room')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox',{name:'Requirement details'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab',{name:'Measurements'}));
  expect(screen.getByRole('tabpanel',{name:'Measurements'})).toBeVisible();
  expect(screen.getByText('2385')).toHaveTextContent('2385 mm');
  expect(screen.queryByRole('button',{name:'Add requirement'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Add measurement'})).toBeVisible();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab',{name:'Site plan'})).toHaveAttribute('aria-selected','true');
  expect(screen.getByRole('button',{name:'Add site plan'})).toBeVisible();
  expect(screen.queryByText('Reception desk')).not.toBeInTheDocument();
 });
 it.each([['measurements','Measurements'],['file','Site plan']] as const)('opens the old %s view on the correct tab', (view,label) => {
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view={view}/></DesignSystemProvider>);
  expect(screen.getByRole('tab',{name:label})).toHaveAttribute('aria-selected','true');
 });
 it('creates a requirement through the original form and saves its room and text',async()=>{
  vi.mocked(fetch).mockImplementation(async(_url,init)=>({ok:true,json:async()=>init?.method==='PUT'?{...entry,...JSON.parse(String(init.body)),version:1}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData}/></DesignSystemProvider>);
  await user.click(screen.getByRole('button',{name:'Add requirement'}));
  expect(screen.getByRole('dialog',{name:'Add requirement'})).toBeVisible();
  await user.type(screen.getByRole('textbox',{name:'Client requirement'}),'New storage');
  await user.type(screen.getByRole('textbox',{name:'Client notes · optional'}),'Deep drawers');
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  expect(await screen.findByRole('button',{name:'Open New storage'})).toBeVisible();
  const call=vi.mocked(fetch).mock.calls.find(([,init])=>init?.method==='PUT')!;
  expect(String(call[0])).toContain('/entries?');
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({title:'New storage',note:'Deep drawers',roomId:null,kind:'requirement'});
 });
 it('edits existing rich text through a plain form without conflicting with its stored document',async()=>{
  const rich={...entry,document:{version:1 as const,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:entry.note}]}]}}};
  vi.mocked(fetch).mockImplementation(async(_url,init)=>({ok:true,json:async()=>init?.method==='PUT'?{...rich,...JSON.parse(String(init.body)),version:2}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,entries:[rich]}}/></DesignSystemProvider>);
  await waitFor(()=>expect(screen.queryByText('Loading requirements…')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button',{name:'Open Reception desk'}));
  const notes=screen.getByRole('textbox',{name:'Client notes · optional'});
  await user.clear(notes); await user.type(notes,'Revised finish');
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  await screen.findByText('Saved.');
  const call=vi.mocked(fetch).mock.calls.find(([,init])=>init?.method==='PUT')!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({id:'entry',version:1,note:'Revised finish',document:{version:1,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Revised finish'}]}]}}});
 });
 it('keeps a CRM-linked requirement once and saves the same note and scope IDs',async()=>{
  const scoped={...entry,id:'scope',version:3};
  const linked={...linkedNote,scope:scoped};
  vi.mocked(fetch).mockImplementation(async(url,init)=>({ok:true,json:async()=>String(url).includes('catalog-options')?{items:[]}:{items:[init?.method==='PUT'?{...linked,...JSON.parse(String(init.body)),version:3,scope:{...scoped,version:4}}:linked],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,entries:[scoped]}}/></DesignSystemProvider>);
  await user.click(await screen.findByRole('button',{name:'Open Kitchen storage'}));
  expect(screen.queryByRole('button',{name:'Open Reception desk'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Continue'}));
  expect(screen.getByRole('link',{name:'Download Kitchen.png'})).toHaveAttribute('href','/api/workspace/requirement-notes/case/case/entry/assets/photo?workspaceId=workspace');
  await user.click(screen.getByRole('button',{name:'Back'}));
  await user.type(screen.getByRole('textbox',{name:'Client requirement'}),' updated');
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  await screen.findByText('Requirement saved.');
  const call=vi.mocked(fetch).mock.calls.find(([,init])=>init?.method==='PUT')!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({id:'entry',version:2,title:'Kitchen storage updated',assetIds:['photo'],scope:{id:'scope',version:3,assetIds:[]}});
 });
 it('edits and saves measurements in the original measurement form',async()=>{
  vi.mocked(fetch).mockImplementation(async(url,init)=>({ok:true,json:async()=>String(url).includes('/specifications/')?{...blankSpecification(),...JSON.parse(String(init?.body)),version:2}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view="measurements"/></DesignSystemProvider>);
  await waitFor(()=>expect(screen.queryByText('Loading requirements…')).not.toBeInTheDocument());
  await user.click(screen.getByRole('button',{name:'Edit measurements for Reception desk'}));
  expect(screen.getByRole('dialog',{name:'Reception desk · Measurements'})).toBeVisible();
  const actual=screen.getByRole('spinbutton',{name:'Actual value'});
  await user.clear(actual); await user.type(actual,'2400');
  await user.click(screen.getByRole('button',{name:'Save measurements'}));
  expect(await screen.findByText('Measurements saved.')).toBeVisible();
  const call=vi.mocked(fetch).mock.calls.find(([url,init])=>String(url).includes('/specifications/entry')&&init?.method==='PUT')!;
  expect(JSON.parse(String(call[1]?.body)).dimensions[0]).toMatchObject({name:'Width',measured:2400,unit:'mm',approximate:2400});
 });
 it('opens the original site plan form only from the site plan tab',async()=>{
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData}/></DesignSystemProvider>);
  expect(screen.queryByRole('button',{name:'Add site plan'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('tab',{name:'Site plan'}));
  await user.click(screen.getByRole('button',{name:'Add site plan'}));
  expect(screen.getByRole('dialog',{name:'Add site plan'})).toBeVisible();
  await user.type(screen.getByRole('textbox',{name:'Title'}),'Ground floor');
  await user.click(screen.getByRole('button',{name:'Continue'}));
  expect(screen.getByLabelText('Attach reference files')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Save site plan'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Attach a site layout before saving.');
 });
 it('retains read-only access and existing rows when shared notes fail',async()=>{
  vi.mocked(fetch).mockRejectedValue(new Error('Connection unavailable'));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,canEdit:false,caseStatus:'released'}}/></DesignSystemProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
  await user.click(screen.getByRole('button',{name:'Open Reception desk'}));
  expect(screen.getByRole('textbox',{name:'Client requirement'})).toBeDisabled();
  expect(screen.queryByRole('button',{name:'Save requirement'})).not.toBeInTheDocument();
 });
});
