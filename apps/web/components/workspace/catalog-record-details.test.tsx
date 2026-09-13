import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DesignSystemProvider } from '@/design-system';
import { blankCatalogRecord, type CatalogRecord } from '@/lib/workspace/catalog';
import { CatalogRecordDetails } from './catalog-record-details';
const work={...blankCatalogRecord('work'),id:'work',name:'Wardrobe',version:1};
const component:CatalogRecord={...blankCatalogRecord('construction'),id:'carcass',name:'Carcass',version:1,links:[{relation:'work',targetId:work.id}],configuration:{recordRole:'component'}};
describe('Master Data shared component table',()=>{
 it('shows details without edit actions to a viewer',()=>{
  render(<DesignSystemProvider><CatalogRecordDetails record={work} items={[work,component]} canManage={false} busy={false} onOpen={()=>{}} onEdit={()=>{}} onPrice={()=>{}} onAddComponent={()=>{}}/></DesignSystemProvider>);
  const table=screen.getByRole('table',{name:'Item components'});
  expect(table).toHaveTextContent('Carcass');
  expect(within(table).queryByRole('button',{name:'Configure'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Add component'})).not.toBeInTheDocument();
 });
 it('configures the selected component for a manager after filtering',async()=>{
  const onEdit=vi.fn(),user=userEvent.setup();
  render(<DesignSystemProvider><CatalogRecordDetails record={work} items={[work,component]} canManage busy={false} onOpen={()=>{}} onEdit={onEdit} onPrice={()=>{}} onAddComponent={()=>{}}/></DesignSystemProvider>);
  await user.type(screen.getByRole('searchbox',{name:'Search item components'}),'Carcass');
  await user.click(within(screen.getByRole('table',{name:'Item components'})).getByRole('button',{name:'Configure'}));
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(component);
 });
});
