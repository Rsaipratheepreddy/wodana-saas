import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DesignSystemProvider } from '@/design-system';
import { blankEntry, blankSpecification, briefFields, type CaseContent, type ScopeEntry } from '@/lib/pre-project/content';
import { ScopeNoteCards } from './scope-note-cards';
import { BriefScopePage } from './brief-scope-page';
// Persistence tests isolate the document input; rich-editor interactions are checked in the browser.
vi.mock('../crm/note-rich-editor',()=>({NoteRichEditor:({document,onChange,writable}:any)=><textarea aria-label="Requirement notes" readOnly={!writable} value={document.content.content?.map((p:any)=>p.content?.map((t:any)=>t.text).join('')).join('\n')??''} onChange={e=>onChange({version:1,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:e.target.value}]}]}})}/>}));
vi.mock('next/font/google',()=>({Caveat:()=>({variable:'note-font'})}));
let activeSearchParams = new URLSearchParams();
vi.mock('next/navigation',()=>({useSearchParams:()=>activeSearchParams,useRouter:()=>({push:vi.fn()})}));
beforeEach(()=>{activeSearchParams=new URLSearchParams();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({items:[],canEdit:true})}));});
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

const gatheringData:CaseContent={workspaceId:'workspace',caseId:'case',canEdit:true,caseStatus:'active',fromCrm:false,crmContext:{description:null,opportunityAmount:null,currencyCode:'AED'},rooms:[],entries:[entry],coverage:{roomCount:0,coveredRoomCount:0,uncoveredRooms:[],wholeProjectRequirementCount:1,undecidedItemIds:['entry'],clientDraftItemIds:[],missingMeasurementItemIds:[],verifiedMeasurementItemIds:[]},brief:{...(Object.fromEntries(Object.keys(briefFields).map(k=>[k,''])) as Record<keyof typeof briefFields,string>),currencyCode:'AED',budgetAmount:'',version:0}};
const linkedNote={id:'entry',version:2,title:'Kitchen storage',note:'Deep drawers',archived:false,assets:[{id:'photo',name:'Kitchen.png',mimeType:'image/png',byteSize:240,hasPreview:true}],links:['https://example.com/plan']};
describe('Requirements tabs and original forms', () => {
 it('opens a universal-search room link with that room already selected',()=>{
  activeSearchParams=new URLSearchParams('room=bedroom');
  const living={id:'living',name:'Living room',version:1};const bedroom={id:'bedroom',name:'Bedroom',version:1};
  const livingEntry={...entry,id:'living-entry',title:'Living sofa',roomId:'living',roomName:'Living room'};
  const bedroomEntry={...entry,id:'bedroom-entry',title:'Bedroom wardrobe',roomId:'bedroom',roomName:'Bedroom'};
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,rooms:[living,bedroom],entries:[livingEntry,bedroomEntry]}}/></DesignSystemProvider>);
  expect(screen.getByRole('article',{name:'Bedroom wardrobe'})).toBeVisible();
  expect(screen.queryByRole('article',{name:'Living sofa'})).not.toBeInTheDocument();
 });
 it('keeps scope decisions on each note without a second overview dashboard',()=>{
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData}/></DesignSystemProvider>);
  expect(screen.getByRole('button',{name:'To decide'})).toBeVisible();
  expect(screen.queryByRole('region',{name:'Discovery coverage'})).not.toBeInTheDocument();
 });
 it('shows saved measurements in one compact register without a card switch',async()=>{
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view="measurements"/></DesignSystemProvider>);
  await waitFor(()=>expect(document.querySelector('.wd-skeleton')).toBeNull());
  expect(screen.queryByRole('button',{name:'Cards view'})).not.toBeInTheDocument();
  expect(screen.getByRole('table',{name:'Measurements'})).toHaveTextContent('2385 mm');
  await user.click(screen.getByRole('button',{name:'Edit measurements for Reception desk'}));
  expect(screen.getByRole('dialog',{name:'Reception desk · Measurements'})).toBeVisible();
  expect(screen.getByRole('textbox',{name:'Measured size'})).toHaveValue('2385');
 });
 it('archives and restores a card through real versioned saves',async()=>{
  vi.mocked(fetch).mockImplementation(async(_url,init)=>({ok:true,json:async()=>init?.method==='PUT'?{...entry,...JSON.parse(String(init.body)),archivedAt:JSON.parse(String(init.body)).archived?'2026-09-22':null,version:2}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData}/></DesignSystemProvider>);
  await user.click(within(screen.getByRole('article')).getByRole('button',{name:'Actions'}));
  await user.click(screen.getByRole('menuitem',{name:'Archive'}));
  await waitFor(()=>expect(screen.queryByRole('article')).not.toBeInTheDocument());
  await user.click(screen.getByRole('checkbox',{name:'Archived'}));
  expect(screen.getByRole('article')).toBeVisible();
  await user.click(within(screen.getByRole('article')).getByRole('button',{name:'Actions'}));
  await user.click(screen.getByRole('menuitem',{name:'Restore'}));
  await waitFor(()=>expect(screen.queryByRole('article')).not.toBeInTheDocument());
  const bodies=vi.mocked(fetch).mock.calls.filter(([,init])=>init?.method==='PUT').map(([,init])=>JSON.parse(String(init?.body)));
  expect(bodies).toEqual([expect.objectContaining({version:1,archived:true}),expect.objectContaining({version:2,archived:false})]);
 });
 it('keeps the redirected Site plans route in card view',()=>{
  activeSearchParams=new URLSearchParams('tab=site-plan');
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,entries:[{...entry,kind:'file'}]}}/></DesignSystemProvider>);
  expect(screen.getByRole('article')).toBeVisible();
  expect(screen.getByRole('button',{name:'Cards view'})).toHaveAttribute('aria-pressed','true');
 });
 it('adds a measurement from the top button and preserves existing dimensions',async()=>{
  vi.mocked(fetch).mockImplementation(async(url,init)=>({ok:true,json:async()=>String(url).includes('/specifications/')?{...blankSpecification(),...JSON.parse(String(init?.body)),version:2}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view="measurements"/></DesignSystemProvider>);
  await waitFor(()=>expect(document.querySelector('.wd-skeleton')).toBeNull());
  await user.click(screen.getByRole('button',{name:'Add measurement'}));
  const dialog=screen.getByRole('dialog',{name:'Add measurement'});
  await user.click(within(dialog).getByRole('button',{name:/Measurement type/}));
  await user.click(screen.getByRole('option',{name:'Height'}));
  await user.type(within(dialog).getByRole('textbox',{name:'Measured size'}),'2750');
  await user.type(within(dialog).getByRole('textbox',{name:'Notes (optional)'}),'Site laser measurement');
  await user.click(within(dialog).getByRole('button',{name:'Save measurement'}));
  expect(await screen.findByText('Measurement saved.')).toBeVisible();
  const call=vi.mocked(fetch).mock.calls.find(([url,init])=>String(url).includes('/specifications/entry')&&init?.method==='PUT')!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({version:1,dimensions:[{id:'width',name:'Width',measured:2385,approximate:2400},{name:'Height',measured:2750,unit:'mm',evidence:'Site laser measurement'}]});
  expect(within(screen.getByRole('table',{name:'Measurements'})).getByText('2750 mm')).toBeVisible();
 });
 it('retains the entered measurement when saving fails',async()=>{
  vi.mocked(fetch).mockImplementation(async(url)=>({ok:!String(url).includes('/specifications/'),json:async()=>String(url).includes('/specifications/')?{message:'This measurement changed. Reopen the latest record.'}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view="measurements"/></DesignSystemProvider>);
  await user.click(screen.getByRole('button',{name:'Add measurement'}));
  await user.click(screen.getByRole('button',{name:/Measurement type/}));
  await user.click(screen.getByRole('option',{name:'Height'}));
  await user.type(screen.getByRole('textbox',{name:'Measured size'}),'2750');
  await user.type(screen.getByRole('textbox',{name:'Notes (optional)'}),'Site photo');
  await user.click(screen.getByRole('button',{name:'Save measurement'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('This measurement changed');
  expect(screen.getByRole('textbox',{name:'Measured size'})).toHaveValue('2750');
  expect(screen.getByRole('button',{name:/Height Measurement type/})).toBeVisible();
 });
 it('captures a named item and measurement without creating a requirement first',async()=>{
  vi.mocked(fetch).mockImplementation(async(url,init)=>({ok:true,json:async()=>String(url).includes('/specifications/')?{...blankSpecification(),...JSON.parse(String(init?.body)),version:1}:init?.method==='PUT'?{...blankEntry(),...JSON.parse(String(init.body)),version:1,assets:[],catalogLinks:[]}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,entries:[]}} view="measurements"/></DesignSystemProvider>);
  await user.click(screen.getByRole('button',{name:'Add measurement'}));
  expect(screen.queryByRole('button',{name:'Add requirement'})).not.toBeInTheDocument();
  await user.type(screen.getByRole('textbox',{name:'Item name'}),'Kitchen wall');
  await user.click(screen.getByRole('button',{name:/Measurement type/}));
  await user.click(screen.getByRole('option',{name:'Width'}));
  await user.type(screen.getByRole('textbox',{name:'Measured size'}),'2400');
  await user.click(screen.getByRole('button',{name:'Save measurement'}));
  expect(await screen.findByText('Measurement saved.')).toBeVisible();
  expect(screen.getByText('2400 mm')).toBeVisible();
  const call=vi.mocked(fetch).mock.calls.find(([url,init])=>String(url).includes('/specifications/')&&init?.method==='PUT')!;
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({dimensions:[{name:'Width',measured:2400,evidence:''}]});
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
 it('lists only requirements on Requirements; moodboard pins and site photos stay on their own tabs',()=>{
  const entries=[entry,{...entry,id:'pin',kind:'inspiration' as const,title:'Warm oak pin'},{...entry,id:'photo',kind:'file' as const,title:'Living room wall'}];
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,entries}}/></DesignSystemProvider>);
  expect(screen.getByRole('article',{name:'Reception desk'})).toBeVisible();
  expect(screen.queryByRole('article',{name:'Warm oak pin'})).not.toBeInTheDocument();
  expect(screen.queryByRole('article',{name:'Living room wall'})).not.toBeInTheDocument();
 });
 it('opens notes without a duplicate local tab bar or table switch',()=>{
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData}/></DesignSystemProvider>);
  expect(screen.getByRole('article',{name:'Reception desk'})).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
 });
 it.each([['measurements','Add measurement'],['file','Add site plan']] as const)('opens the %s route with its appropriate action',(view,label)=>{
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view={view}/></DesignSystemProvider>);
  expect(screen.getByRole('button',{name:label})).toBeVisible();
 });
 it('creates a requirement through the note editor and saves its room and text',async()=>{
  vi.mocked(fetch).mockImplementation(async(_url,init)=>({ok:true,json:async()=>init?.method==='PUT'?{...entry,...JSON.parse(String(init.body)),version:1}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData}/></DesignSystemProvider>);
  await user.click(screen.getByRole('button',{name:'Add requirement'}));
  expect(screen.getByRole('dialog',{name:'Enquiry requirements'})).toBeVisible();
  await user.type(screen.getByRole('textbox',{name:'Client requirement'}),'New storage');
  await user.type(screen.getByRole('textbox',{name:'Requirement notes'}),'Deep drawers');
  await user.click(screen.getByRole('button',{name:'Save requirement'}));
  expect(await screen.findByRole('button',{name:'Open details for New storage'})).toBeVisible();
  const call=vi.mocked(fetch).mock.calls.find(([,init])=>init?.method==='PUT')!;
  expect(String(call[0])).toContain('/entries?');
  expect(JSON.parse(String(call[1]?.body))).toMatchObject({title:'New storage',note:'Deep drawers',roomId:null,kind:'requirement'});
 });
 it('edits existing rich text through the document editor without conflicting with its stored document',async()=>{
  const rich={...entry,document:{version:1 as const,content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:entry.note}]}]}}};
  vi.mocked(fetch).mockImplementation(async(_url,init)=>({ok:true,json:async()=>init?.method==='PUT'?{...rich,...JSON.parse(String(init.body)),version:2}:{items:[],canEdit:true}} as Response));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,entries:[rich]}}/></DesignSystemProvider>);
  await waitFor(()=>expect(document.querySelector('.wd-skeleton')).toBeNull());
  await user.click(screen.getByRole('button',{name:'Open details for Reception desk'}));
  const notes=screen.getByRole('textbox',{name:'Requirement notes'});
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
  await user.click(await screen.findByRole('button',{name:'Open details for Kitchen storage'}));
  expect(screen.queryByRole('button',{name:'Open details for Reception desk'})).not.toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Download Kitchen.png'})).toHaveAttribute('href','/api/workspace/requirement-notes/case/case/entry/assets/photo?workspaceId=workspace');
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
  await waitFor(()=>expect(document.querySelector('.wd-skeleton')).toBeNull());
  await user.click(screen.getByRole('button',{name:'Edit measurements for Reception desk'}));
  expect(screen.getByRole('dialog',{name:'Reception desk · Measurements'})).toBeVisible();
  const actual=screen.getByRole('textbox',{name:'Measured size'});
  await user.clear(actual); await user.type(actual,'2400');
  await user.click(screen.getByRole('button',{name:'Save measurements'}));
  expect(await screen.findByText('Measurements saved.')).toBeVisible();
  const call=vi.mocked(fetch).mock.calls.find(([url,init])=>String(url).includes('/specifications/entry')&&init?.method==='PUT')!;
  expect(JSON.parse(String(call[1]?.body)).dimensions[0]).toMatchObject({name:'Width',measured:2400,unit:'mm',approximate:2400});
 });
 it('requires an attachment when saving a site plan',async()=>{
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={gatheringData} view="file"/></DesignSystemProvider>);
  await user.click(screen.getByRole('button',{name:'Add site plan'}));
  expect(screen.getByRole('dialog',{name:'Site plan'})).toBeVisible();
  await user.type(screen.getByRole('textbox',{name:'Title'}),'Ground floor');
  await user.click(screen.getByRole('button',{name:'Save site plan'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Attach a site layout before saving.');
 });
 it('retains read-only access and existing rows when shared notes fail',async()=>{
  vi.mocked(fetch).mockRejectedValue(new Error('Connection unavailable'));
  const user=userEvent.setup();
  render(<DesignSystemProvider><BriefScopePage initialData={{...gatheringData,canEdit:false,caseStatus:'released'}}/></DesignSystemProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection unavailable');
  // Managing rooms is an edit; the brief opens read-only (Close, no Save).
  expect(screen.queryByRole('button',{name:'Manage rooms'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Project brief'}));
  const brief=await screen.findByRole('dialog',{name:'Project brief'});
  expect(within(brief).queryByRole('button',{name:'Save brief'})).not.toBeInTheDocument();
  await user.click(within(brief).getByRole('button',{name:'Close'}));
  await user.click(screen.getByRole('button',{name:'Open details for Reception desk'}));
  expect(screen.getByRole('textbox',{name:'Client requirement'})).toBeDisabled();
  expect(screen.queryByRole('button',{name:'Save requirement'})).not.toBeInTheDocument();
 });
});
