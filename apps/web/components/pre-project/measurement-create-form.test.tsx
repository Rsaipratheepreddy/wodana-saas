import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '@/design-system';
import { blankEntry, blankSpecification, briefFields, deriveDiscoveryCoverage, type CaseContent } from '@/lib/pre-project/content';
import { MeasurementCreateForm } from './measurement-create-form';

const catalogItem = {id:'catalog-item',name:'Base cabinet',code:'BC01',kind:'work',version:2,catalogId:'catalog'};
const data:CaseContent = {workspaceId:'workspace',caseId:'case',canEdit:true,rooms:[],entries:[],coverage:deriveDiscoveryCoverage([],[]),caseStatus:'active',fromCrm:false,crmContext:{description:null,opportunityAmount:null,currencyCode:'AED'},brief:{...(Object.fromEntries(Object.keys(briefFields).map(key=>[key,''])) as Record<keyof typeof briefFields,string>),version:0,currencyCode:'AED',budgetAmount:''}};

afterEach(()=>vi.unstubAllGlobals());

describe('direct measurement capture',()=>{
  it('saves a real catalog reference with the item and keeps the selected units',async()=>{
    const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>({ok:true,json:async()=>
      String(url).includes('catalog-options')?{items:[catalogItem]}:
      String(url).includes('/specifications/')?{...blankSpecification(),...JSON.parse(String(init?.body)),version:1}:
      {...blankEntry(),...JSON.parse(String(init?.body)),version:1}
    } as Response));
    vi.stubGlobal('fetch',fetcher);
    const saved=vi.fn();const user=userEvent.setup();
    render(<DesignSystemProvider><MeasurementCreateForm data={data} entries={[]} initialRoom="all" onClose={()=>{}} onCreateRequirement={()=>{}} onSaved={saved}/></DesignSystemProvider>);
    const catalog=screen.getByRole('combobox',{name:'Catalog item (optional)'});
    await user.type(catalog,'Base');
    await waitFor(()=>expect(fetcher).toHaveBeenCalled());
    // The results may already have opened the list while typing; otherwise open it.
    if(!screen.queryByRole('listbox'))await user.click(screen.getByRole('button',{name:'Show options Catalog item (optional)'}));
    await user.click(await screen.findByRole('option',{name:'Base cabinet · BC01'}));
    expect(screen.getByRole('textbox',{name:'Item name'})).toHaveValue('Base cabinet');
    await user.click(screen.getByRole('button',{name:/Measurement type/}));
    await user.click(screen.getByRole('option',{name:'Depth'}));
    await user.click(screen.getByRole('button',{name:'mm Unit'}));
    await user.click(screen.getByRole('option',{name:'cm'}));
    await user.type(screen.getByRole('textbox',{name:'Measured size'}),'60');
    await user.click(screen.getByRole('button',{name:'Save measurement'}));
    await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    const itemCall=fetcher.mock.calls.find(([url,init])=>String(url).includes('/entries?')&&init?.method==='PUT');
    expect(JSON.parse(String(itemCall?.[1]?.body))).toMatchObject({title:'Base cabinet',catalogLinks:[{role:'work',recordId:'catalog-item'}]});
    expect(saved.mock.calls[0][1].dimensions).toEqual([expect.objectContaining({name:'Depth',measured:60,unit:'cm',evidence:''})]);
  });

  it('retries a failed dimension save without creating the same item twice',async()=>{
    let failures=1;
    const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{
      if(String(url).includes('catalog-options'))return {ok:true,json:async()=>({items:[]})} as Response;
      if(String(url).includes('/specifications/')&&failures-->0)return {ok:false,json:async()=>({message:'Connection interrupted'})} as Response;
      return {ok:true,json:async()=>({...blankEntry(),...blankSpecification(),...JSON.parse(String(init?.body)),version:1})} as Response;
    });
    vi.stubGlobal('fetch',fetcher);
    const saved=vi.fn();const user=userEvent.setup();
    render(<DesignSystemProvider><MeasurementCreateForm data={data} entries={[]} initialRoom="all" onClose={()=>{}} onCreateRequirement={()=>{}} onSaved={saved}/></DesignSystemProvider>);
    await user.type(screen.getByRole('textbox',{name:'Item name'}),'Bedroom wall');
    await user.click(screen.getByRole('button',{name:/Measurement type/}));
    await user.click(screen.getByRole('option',{name:'Height'}));
    await user.type(screen.getByRole('textbox',{name:'Measured size'}),'2700');
    await user.click(screen.getByRole('button',{name:'Save measurement'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
    expect(screen.getByRole('textbox',{name:'Measured size'})).toHaveValue('2700');
    await user.click(screen.getByRole('button',{name:'Save measurement'}));
    await waitFor(()=>expect(saved).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls.filter(([url,init])=>String(url).includes('/entries?')&&init?.method==='PUT')).toHaveLength(1);
  });
});
