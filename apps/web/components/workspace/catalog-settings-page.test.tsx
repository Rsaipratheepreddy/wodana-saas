import {render,screen,within,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {blankCatalogRecord,type CatalogPageData,type CatalogRecord} from '@/lib/workspace/catalog';
import {CatalogSettingsPage} from './catalog-settings-page';
const {push}=vi.hoisted(()=>({push:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({push})}));
afterEach(()=>{vi.unstubAllGlobals();push.mockClear();});
function fixture():CatalogPageData {
 const row=(kind:CatalogRecord['kind'],id:string,name:string,links:CatalogRecord['links']=[])=>({...blankCatalogRecord(kind),id,name,code:id.toUpperCase(),version:1,catalogId:'catalog',links});
 return {workspaceId:'workspace',canManage:true,starter:{count:0,version:'1',market:'IN'},items:[
 {...row('catalog_group','old','Old library'),catalogId:undefined},
 {...row('catalog_group','catalog','Room Builder'),catalogId:undefined,attributes:[{name:'Default catalog',value:'true'}]},
 row('room','bedroom','Bedroom'),row('room','kitchen','Kitchen'),
 row('work','wardrobe','Wardrobe',[{relation:'room',targetId:'bedroom'}]),row('work','cabinet','Cabinet',[{relation:'room',targetId:'kitchen'}]),
 row('variant','budget','Budget',[{relation:'work',targetId:'wardrobe'}]),
 {...row('construction','base','Carcass',[{relation:'work',targetId:'wardrobe'}]),configuration:{recordRole:'component'}},
 {...row('construction','upgrade','Upgraded hinges',[{relation:'work',targetId:'wardrobe'},{relation:'variant',targetId:'budget'}]),configuration:{recordRole:'component'}},
 row('material','ply','Plywood'),
 ]};
}
describe('room catalog navigation',()=>{
 it('opens a materials shortcut directly in the material working view',()=>{
  render(<CatalogSettingsPage initialData={fixture()} initialView="products"/>);
  expect(screen.queryByRole('list',{name:'Room grid'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Add material'})).toBeVisible();
 });
 it('opens the default catalog as rooms without the old groups screen',()=>{
  render(<CatalogSettingsPage initialData={fixture()}/>);
  expect(screen.getByRole('list',{name:'Room grid'})).toBeVisible();
  expect(screen.queryByRole('table',{name:'Rooms'})).not.toBeInTheDocument();
  expect(within(screen.getByRole('listitem',{name:'Bedroom'})).getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '1 item')).toBeVisible();
  expect(screen.queryByRole('button',{name:'Edit table'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Open Bedroom'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'New group'})).not.toBeInTheDocument();
  expect(screen.getByRole('heading',{level:1,name:'Room Builder'})).toBeVisible();
  expect(screen.getByRole('link',{name:'Catalogs'})).toHaveAttribute('href','/workspace/catalogs');
  expect(screen.getByRole('button',{name:/Room Builder/})).toBeVisible();
 });
 it('keeps workbook amounts separate from saved prices',async()=>{
  const data=fixture();data.canViewCosts=true;
  data.items.find(record=>record.id==='wardrobe')!.attributes=[{name:'estimated_cost_inr',value:'63000'}];
  const user=userEvent.setup();render(<CatalogSettingsPage initialData={data}/>);
  await user.click(within(screen.getByRole('group',{name:'Master Data sections'})).getByRole('button',{name:'Items'}));
  const price=screen.getByRole('button',{name:'Prices for Wardrobe'});
  expect(price).toHaveTextContent('No saved price');
  expect(price).toHaveTextContent('Imported amount · needs review');
  expect(price).not.toHaveTextContent('63,000');
  await user.click(price);
  expect(await screen.findByRole('dialog',{name:'Prices · Wardrobe'})).toHaveTextContent('₹63,000');
 });
 it('does not display imported or saved cost amounts to a selling-only viewer',async()=>{
  const data=fixture();data.canViewCosts=false;
  data.items.find(record=>record.id==='wardrobe')!.attributes=[{name:'estimated_cost_inr',value:'63000'}];
  data.items.push({...blankCatalogRecord('rate_card'),id:'cost-rate',catalogId:'catalog',name:'Wardrobe cost',version:1,links:[{relation:'work',targetId:'wardrobe'}],configuration:{priceType:'cost',amount:63000,currency:'INR'}});
  const user=userEvent.setup();render(<CatalogSettingsPage initialData={data}/>);
  await user.click(within(screen.getByRole('group',{name:'Master Data sections'})).getByRole('button',{name:'Items'}));
  const price=screen.getByRole('button',{name:'Prices for Wardrobe'});
  expect(price).toHaveTextContent('No saved price');
  expect(price).not.toHaveTextContent('Imported amount');
  await user.click(price);
  const dialog=await screen.findByRole('dialog',{name:'Prices · Wardrobe'});
  expect(dialog).not.toHaveTextContent('63,000');
  expect(dialog).not.toHaveTextContent('Imported prices');
 });
 it('adds a room to the master and updates its card after editing',async()=>{
  const request=vi.fn(async(_url:string,options:RequestInit)=>({ok:true,json:async()=>({...JSON.parse(String(options.body)),version:JSON.parse(String(options.body)).version+1,archived:false})}));
  vi.stubGlobal('fetch',request);const user=userEvent.setup();render(<CatalogSettingsPage initialData={fixture()}/>);
  await user.click(screen.getByRole('button',{name:'Add room'}));
  const name=await screen.findByRole('textbox',{name:'Name'});await user.type(name,'Study');
  await user.click(screen.getByRole('button',{name:'Save'}));
  const card=await screen.findByRole('listitem',{name:'Study'});expect(within(card).getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === '0 items')).toBeVisible();
  expect(JSON.parse(String(request.mock.calls[0][1].body))).toMatchObject({kind:'room',catalogId:'catalog',name:'Study'});
  await user.click(screen.getByRole('button',{name:'Edit Study'}));
  const editName=await screen.findByRole('textbox',{name:'Name'});await user.clear(editName);await user.type(editName,'Home office');
  await user.click(screen.getByRole('button',{name:'Save'}));
  expect(await screen.findByRole('listitem',{name:'Home office'})).toBeVisible();expect(screen.queryByRole('listitem',{name:'Study'})).not.toBeInTheDocument();
 });
 it('lets an empty workspace create its first room without catalog setup',async()=>{
  const empty={...fixture(),items:[]};
  const saved={...blankCatalogRecord('room'),id:'first-room',name:'Study',catalogId:'catalog',version:1};
  const request=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>saved}).mockResolvedValueOnce({ok:true,json:async()=>({...empty,items:[fixture().items[1],saved]})});
  vi.stubGlobal('fetch',request);const user=userEvent.setup();render(<CatalogSettingsPage initialData={empty}/>);
  expect(screen.getByText('Create your first room')).toBeVisible();
  await user.click(screen.getByRole('button',{name:'Add room'}));await user.type(await screen.findByRole('textbox',{name:'Name'}),'Study');await user.click(screen.getByRole('button',{name:'Save'}));
  expect(await screen.findByRole('listitem',{name:'Study'})).toBeVisible();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Edit Study'})).toBeEnabled());
  expect(JSON.parse(String(request.mock.calls[0][1].body)).catalogId).toBeUndefined();
 });
 it('keeps catalog creation out of master actions while allowing existing catalogs to be selected',async()=>{
  const user=userEvent.setup();render(<CatalogSettingsPage initialData={fixture()}/>);
  await user.click(screen.getByRole('button',{name:'Master Data actions'}));
  expect(screen.queryByRole('menuitem',{name:'New catalog'})).not.toBeInTheDocument();
  expect(screen.getByRole('menuitem',{name:'Export master data'})).toBeVisible();
 });
 it('switches between existing catalogs without mixing their rooms or items',async()=>{
  const data=fixture();data.items.push({...blankCatalogRecord('room'),id:'old-room',name:'Living room',code:'OLD_ROOM',version:1,catalogId:'old'});
  data.items.push({...blankCatalogRecord('work'),id:'old-item',name:'Old sofa',code:'OLD_SOFA',version:1,catalogId:'old',links:[{relation:'room',targetId:'old-room'}]});
  const user=userEvent.setup();const page=render(<CatalogSettingsPage initialData={data}/>);
  await user.click(screen.getByRole('button',{name:/Room Builder/}));
  await user.click(screen.getByRole('option',{name:'Old library'}));
  expect(push).toHaveBeenCalledWith('/workspace/catalogs?catalogId=old');
  page.unmount();render(<CatalogSettingsPage initialData={data} initialCatalogId="old"/>);
  expect(screen.getByRole('button',{name:'Open Living room'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Open Bedroom'})).not.toBeInTheDocument();
  await user.click(within(screen.getByRole('group',{name:'Master Data sections'})).getByRole('button',{name:'Items'}));
  expect(screen.getByRole('button',{name:'Open Old sofa'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Open Wardrobe'})).not.toBeInTheDocument();
 });
 it('limits items to the selected room and clears search on navigation',async()=>{
  const user=userEvent.setup();render(<CatalogSettingsPage initialData={fixture()}/>);
  await user.type(screen.getByRole('searchbox'),'bed');
  await user.click(screen.getByRole('button',{name:'Open Bedroom'}));
  expect(screen.getByRole('button',{name:'Open Wardrobe'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Open Cabinet'})).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getByRole('columnheader',{name:'Image'})).toBeVisible();
 });
 it('searches and sorts every room item across table pages',async()=>{
  const data=fixture();const template=data.items.find(r=>r.id==='wardrobe')!;
  data.items.push(...Array.from({length:60},(_,i)=>({...template,id:`item-${i}`,code:`CODE_${i}`,name:`Item ${String(i+1).padStart(2,'0')}`})));
  const user=userEvent.setup();render(<CatalogSettingsPage initialData={data}/>);
  await user.click(screen.getByRole('button',{name:'Open Bedroom'}));
  expect(screen.getByRole('button',{name:'Manage columns'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Export filtered rows'})).toBeVisible();
  expect(screen.getAllByRole('searchbox')).toHaveLength(1);
  expect(screen.queryByRole('button',{name:'Open Wardrobe'})).not.toBeInTheDocument();
  await user.click(within(screen.getByRole('columnheader',{name:'Item'})).getByRole('button',{name:/^Item$/}));
  await user.click(within(screen.getByRole('columnheader',{name:'Item'})).getByRole('button',{name:/^Item$/}));
  expect(within(screen.getByRole('table',{name:'Items'})).getAllByRole('row')[1]).toHaveTextContent('Wardrobe');
  await user.type(screen.getByRole('searchbox'),'CODE_59');
  expect(screen.getByRole('button',{name:'Open Item 60'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Open Item 59'})).not.toBeInTheDocument();
 },15000);
 it('shows base materials plus the selected variant materials',async()=>{
  const user=userEvent.setup();render(<CatalogSettingsPage initialData={fixture()}/>);
  await user.click(screen.getByRole('button',{name:'Open Bedroom'}));await user.click(screen.getByRole('button',{name:'Open Wardrobe'}));
  await user.click(within(screen.getByRole('group',{name:'Item sections'})).getByRole('button',{name:'Materials'}));
  expect(screen.getByRole('columnheader',{name:'Image'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Open Carcass'})).toBeVisible();expect(screen.queryByRole('button',{name:'Open Upgraded hinges'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Variants'}));await user.click(screen.getByRole('button',{name:'Open Budget'}));
  expect(screen.getByRole('button',{name:'Open Carcass'})).toBeVisible();expect(screen.getByRole('button',{name:'Open Upgraded hinges'})).toBeVisible();
 });
 it('keeps management controls unavailable to viewers',()=>{
  render(<CatalogSettingsPage initialData={{...fixture(),canManage:false}}/>);
  expect(screen.queryByRole('button',{name:'Add room'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Edit Bedroom'})).not.toBeInTheDocument();
 });
 it('shows rooms immediately while requesting only the selected catalog',async()=>{
  const request=vi.fn((_url:string)=>new Promise(()=>{}));vi.stubGlobal('fetch',request);
  render(<CatalogSettingsPage initialData={{...fixture(),overview:true}}/>);
  expect(screen.getByRole('button',{name:'Open Bedroom'})).toBeVisible();expect(screen.getByRole('button',{name:'Add room'})).toBeDisabled();
  await waitFor(()=>expect(request).toHaveBeenCalledTimes(1));expect(request.mock.calls[0][0]).toContain('catalogId=catalog');
 });
 it('keeps materials inside the selected catalog',async()=>{
  const switchRecord={...blankCatalogRecord('hardware'),id:'smart-switch',name:'Smart switch',code:'SMART_SWITCH',version:1,catalogId:'old'};
  const full={...fixture(),items:[...fixture().items,switchRecord]};
  const user=userEvent.setup();const page=render(<CatalogSettingsPage initialData={full}/>);
  await user.click(within(screen.getByRole('group',{name:'Master Data sections'})).getByRole('button',{name:'Materials'}));
  expect(screen.getByRole('button',{name:'Open Plywood'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Open Smart switch'})).not.toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:/Room Builder Catalog/}));
  await user.click(screen.getByRole('option',{name:'Old library'}));
  expect(push).toHaveBeenCalledWith('/workspace/catalogs?catalogId=old&view=materials');
  page.unmount();render(<CatalogSettingsPage initialData={full} initialCatalogId="old" initialView="products"/>);
  expect(screen.getByRole('button',{name:'Open Smart switch'})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Open Plywood'})).not.toBeInTheDocument();
 });
 it('provides a retry after materials fail to load',async()=>{
  const request=vi.fn().mockRejectedValueOnce(Error('Connection interrupted')).mockResolvedValue({ok:true,json:async()=>fixture()});vi.stubGlobal('fetch',request);
  const user=userEvent.setup();render(<CatalogSettingsPage initialData={{...fixture(),overview:true}}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
  await user.click(await screen.findByRole('button',{name:'Retry'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Add room'})).toBeEnabled());
 });
 it('keeps a failed edit for retry and confirms cancellation',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({message:'This name already exists.'})}));
  const user=userEvent.setup();render(<CatalogSettingsPage initialData={fixture()}/>);await user.click(screen.getByRole('button',{name:'Edit Bedroom'}));
  const input=await screen.findByRole('textbox',{name:'Name'});await user.clear(input);await user.type(input,'My bedroom');
  await user.click(screen.getByRole('button',{name:'Save'}));expect(await screen.findByRole('alert')).toHaveTextContent('This name already exists.');expect(input).toHaveValue('My bedroom');
  await user.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.getByRole('dialog',{name:'Discard unsaved changes?'})).toBeVisible();
 });
 it('makes archived rooms discoverable for restoration',async()=>{
  const data=fixture();data.items.find(r=>r.id==='bedroom')!.archived=true;const user=userEvent.setup();render(<CatalogSettingsPage initialData={data}/>);
  expect(screen.queryByRole('button',{name:'Open Bedroom'})).not.toBeInTheDocument();await user.click(screen.getByRole('checkbox',{name:'Archived'}));
  await user.click(screen.getByRole('button',{name:'Open Bedroom'}));expect(await screen.findByRole('button',{name:'Restore'})).toBeVisible();
 });
});
