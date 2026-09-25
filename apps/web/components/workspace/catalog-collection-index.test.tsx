import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { blankCatalogRecord, type CatalogPageData } from '@/lib/workspace/catalog';
import { CatalogCollectionIndex } from './catalog-collection-index';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({push, refresh}) }));
afterEach(() => { vi.unstubAllGlobals(); push.mockClear(); refresh.mockClear(); });

function fixture(): CatalogPageData {
  const catalog = (id: string, name: string, isDefault = false) => ({...blankCatalogRecord('catalog_group'), id, name, code:id.toUpperCase(), version:1, archived:false, attributes:isDefault ? [{name:'Default catalog',value:'true'}] : []});
  return {workspaceId:'workspace-id',overview:true,canManage:true,starter:{version:'',count:0,market:''},items:[catalog('palm','Palm Living Core Collection'),catalog('room-builder','Room Builder',true)],catalogCounts:[
    {catalogId:'palm',kind:'work',count:534},
    {catalogId:'room-builder',kind:'room',count:35},
    {catalogId:'room-builder',kind:'work',count:243},
    {catalogId:'room-builder',kind:'material',count:5150},
  ]};
}

it('lists separate catalogs and opens one without merging counts', async () => {
  const user = userEvent.setup();
  render(<CatalogCollectionIndex initialData={fixture()} />);
  const table = screen.getByRole('table', {name:'Catalogs table'});
  const palm = within(table).getByRole('row', {name:/Palm Living Core Collection/});
  const room = within(table).getByRole('row', {name:/Room Builder/});
  expect(palm).toHaveTextContent('534');
  expect(palm).not.toHaveTextContent('5150');
  expect(room).toHaveTextContent('35');
  expect(room).toHaveTextContent('5150');
  expect(room).toHaveTextContent('Default');
  await user.click(within(palm).getByRole('link', {name:'Open Palm Living Core Collection'}));
  expect(within(palm).getByRole('link', {name:'Open Palm Living Core Collection'})).toHaveAttribute('href','/workspace/catalogs?catalogId=palm');
});

it('creates another independent catalog from the list', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok:true,json:async()=>({id:'new-id'})}));
  render(<CatalogCollectionIndex initialData={fixture()} />);
  await user.click(screen.getByRole('button', {name:'New catalog'}));
  await user.type(screen.getByRole('textbox', {name:'Catalog name'}), 'Outdoor Collection');
  await user.click(screen.getByRole('button', {name:'Create catalog'}));
  expect(push).toHaveBeenCalledWith('/workspace/catalogs?catalogId=new-id');
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({name:'Outdoor Collection',starter:false});
});

it('hides creation for viewers', () => {
  render(<CatalogCollectionIndex initialData={{...fixture(),canManage:false}} />);
  expect(screen.queryByRole('button', {name:'New catalog'})).not.toBeInTheDocument();
});
