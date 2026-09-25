import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '@/design-system';
import { blankEntry, briefFields, type CaseContent } from '@/lib/pre-project/content';
import { BriefScopePage } from './brief-scope-page';
vi.mock('next/font/google',()=>({Caveat:()=>({variable:'note-font'})}));
vi.mock('next/navigation', () => ({useSearchParams: () => new URLSearchParams(), useRouter: () => ({push: vi.fn()})}));
const rooms = [{id:'kitchen',name:'Kitchen',version:1},{id:'bedroom',name:'Bedroom',version:1}];
const data = {workspaceId:'workspace',caseId:'case',canEdit:true,rooms,entries:[
  {...blankEntry('kitchen'),id:'one',title:'Kitchen drawers',note:'Soft-close hardware',version:1},
  {...blankEntry('bedroom'),id:'two',title:'Bedroom wardrobe',version:1},
],brief:{...Object.fromEntries(Object.keys(briefFields).map(key => [key,''])),version:0},crmContext:{}} as CaseContent;
beforeEach(() => vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({items:[],canEdit:true})})));
afterEach(() => vi.unstubAllGlobals());
describe('Requirements workspace', () => {
  it('keeps the compact project toolbar to search, room filter and add', async () => {
    render(<DesignSystemProvider><BriefScopePage initialData={data} compact/></DesignSystemProvider>);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('heading',{name:'Requirements'})).not.toBeInTheDocument();
    expect(screen.queryByText(/What the client needs/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Project brief'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Manage rooms'})).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox',{name:'Archived'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'To decide'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Actions'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Open details for Kitchen drawers'})).toBeVisible();
    expect(screen.getByRole('button',{name:'Add requirement'})).toBeVisible();
    expect(screen.getByRole('searchbox',{name:'Search requirements'})).toBeVisible();
    expect(screen.getByRole('searchbox',{name:'Search requirements'}).compareDocumentPosition(screen.getByRole('button',{name:'Add requirement'})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole('button',{name:'All rooms Room'}));
    await userEvent.click(screen.getByRole('option',{name:'Archived requirements'}));
    expect(screen.getByText('No archived items match these filters.')).toBeVisible();
  });
  it('filters the notes board by room without a second sidebar', async () => {
    const user=userEvent.setup();
    render(<DesignSystemProvider><BriefScopePage initialData={data}/></DesignSystemProvider>);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('complementary',{name:'Rooms'})).not.toBeInTheDocument();
    const table=screen.getByRole('article',{name:'Kitchen drawers'});
    expect(within(table).getByText('Soft-close hardware')).toBeVisible();
    await user.click(screen.getByRole('button',{name:'All rooms Room'}));
    await user.click(screen.getByRole('option',{name:'Bedroom'}));
    expect(screen.getByRole('article',{name:'Bedroom wardrobe'})).toBeVisible();
    expect(screen.queryByRole('article',{name:'Kitchen drawers'})).not.toBeInTheDocument();
  });
  it('keeps one primary capture action and makes room management available', () => {
    render(<DesignSystemProvider><BriefScopePage initialData={data}/></DesignSystemProvider>);
    expect(screen.getAllByRole('button',{name:'Add requirement'})).toHaveLength(1);
    expect(screen.queryByRole('button',{name:'Paste rows'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Manage rooms'})).toBeVisible();
    expect(screen.queryByRole('button',{name:'Add project note'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Upload photo / plan'})).not.toBeInTheDocument();
  });
});
