import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import type { SupplyQueuePage } from '../../../../services/business-core/src/projects/project-supply-queue';
import { GlobalSupplyPage } from './global-supply-page';

const initial: SupplyQueuePage = {
  canBuy: true, canViewInventory: true,
  rows: [
    {id:'project:shortage:material',projectId:'project',projectName:'Palm Villa',sourceId:'material',kind:'shortage',title:'MR plywood',status:'To order',quantity:5,catalogId:'catalog',catalogVersion:1,unit:'sheet',dueDate:'2026-10-01',supplier:'',href:'/workspace/projects/project/procurement?view=shortages&record=material'},
    {id:'project:enquiry:rfq',projectId:'project',projectName:'Palm Villa',sourceId:'rfq',kind:'enquiry',title:'Oak veneer',status:'enquiry',quantity:12,unit:'m²',dueDate:'2026-10-02',supplier:'Veneer supplier',href:'/workspace/projects/project/procurement?view=enquiries&record=rfq'},
    {id:'project:order:po',projectId:'project',projectName:'Palm Villa',sourceId:'po',kind:'order',title:'Drawer runners',status:'approved',quantity:4,orderedQuantity:10,unit:'set',dueDate:'2026-10-03',supplier:'Hardware supplier',href:'/workspace/projects/project/procurement?view=all&record=po'},
  ],
  stock: [{id:'warehouse-1',location:'Main warehouse',catalogId:'catalog',catalogVersion:1,title:'MR plywood',unit:'sheet',quantity:24,reserved:4}],
};

it('shows material shortages across projects without mixing them with enquiries or orders', async () => {
  const user = userEvent.setup();
  render(<GlobalSupplyPage workspaceId="workspace" initial={initial} mode="purchasing"/>);
  const table = screen.getByRole('table', {name:'Cross-project purchasing'});
  expect(within(table).getByRole('link', {name:'MR plywood'})).toHaveAttribute('href', initial.rows[0].href);
  expect(within(table).getByText('Palm Villa')).toBeVisible();
  expect(within(table).getByText('5 sheet')).toBeVisible();
  expect(within(table).queryByText('Oak veneer')).not.toBeInTheDocument();
  await user.type(screen.getByRole('searchbox', {name:'Search purchasing'}), 'nothing');
  expect(screen.getByText('No matching records')).toBeVisible();
  expect(screen.getByRole('link', {name:/Orders/})).toHaveAttribute('href','/workspace/projects/purchasing?view=order');
});

it('keeps supplier requests with orders and shows their real state', () => {
  render(<GlobalSupplyPage workspaceId="workspace" initial={initial} mode="purchasing" view="order"/>);
  const table = screen.getByRole('table', {name:'Cross-project purchasing'});
  expect(within(table).getByText('Quote requested')).toBeVisible();
  expect(within(table).getByText('Approved')).toBeVisible();
  expect(within(table).getByRole('link', {name:'Review quote'})).toHaveAttribute('href',initial.rows[1].href);
  expect(within(table).getByText('6 of 10 set accepted')).toBeVisible();
});

it('takes closure and inspection links straight to the Shipping section', () => {
  const closeHref = '/workspace/projects/project/procurement?view=deliveries&record=ready';
  const inspectHref = '/workspace/projects/project/procurement?view=deliveries&record=qc';
  const rows: SupplyQueuePage['rows'] = [
    { ...initial.rows[2], id: 'ready', sourceId: 'ready', status: 'acknowledged', quantity: 0, href: closeHref },
    { ...initial.rows[2], id: 'qc', sourceId: 'qc', status: 'acknowledged', quantity: 3, pendingInspection: 3, href: inspectHref },
  ];
  render(<GlobalSupplyPage workspaceId="workspace" initial={{ ...initial, rows }} mode="purchasing" view="order" />);
  const table = screen.getByRole('table', { name: 'Cross-project purchasing' });
  expect(within(table).getByRole('link', { name: 'Close order' })).toHaveAttribute('href', closeHref);
  expect(within(table).getByRole('link', { name: 'View inspection' })).toHaveAttribute('href', inspectHref);
  expect(within(table).getByText('7 of 10 set accepted · 3 pending inspection')).toBeVisible();
  expect(within(table).getByText('Ready to close')).toHaveAttribute('data-tone', 'success');
  expect(within(table).getByText('Inspection pending')).toHaveAttribute('data-tone', 'warning');
});

it('does not offer an unauthorized closure action to a read-only project viewer', () => {
  const href = '/workspace/projects/project/procurement?view=deliveries&record=ready';
  const rows: SupplyQueuePage['rows'] = [
    { ...initial.rows[2], id: 'ready', sourceId: 'ready', status: 'acknowledged', quantity: 0, href },
  ];
  render(<GlobalSupplyPage workspaceId="workspace" initial={{ ...initial, canBuy: false, rows }} mode="purchasing" view="order" />);
  const table = screen.getByRole('table', { name: 'Cross-project purchasing' });
  expect(within(table).queryByRole('link', { name: 'Close order' })).not.toBeInTheDocument();
  expect(within(table).getByRole('link', { name: 'Open order' })).toHaveAttribute('href', href);
});

it('shows company stock separately from project shortages', () => {
  render(<GlobalSupplyPage workspaceId="workspace" initial={initial} mode="inventory"/>);
  const table = screen.getByRole('table', {name:'Workspace inventory'});
  expect(within(table).getByText('Main warehouse')).toBeVisible();
  expect(within(table).getByText('20 sheet')).toBeVisible();
  expect(within(table).getByRole('link',{name:'Open demand'})).toHaveAttribute('href',initial.rows[0].href);
  expect(within(table).queryByText('Palm Villa')).not.toBeInTheDocument();
});

it('does not offer a demand link for stock without a matching catalog item and unit', () => {
  const unrelated = { ...initial.stock[0], catalogId: 'other-catalog', title: 'MR plywood' };
  render(<GlobalSupplyPage workspaceId="workspace" initial={{ ...initial, stock: [unrelated] }} mode="inventory" />);
  const table = screen.getByRole('table', { name: 'Workspace inventory' });
  expect(within(table).queryByRole('link', { name: 'Open demand' })).not.toBeInTheDocument();
  expect(within(table).getByText('—')).toBeVisible();
});

it('resets a purchasing URL search when navigating back to Inventory', () => {
  const { rerender } = render(<GlobalSupplyPage workspaceId="workspace" initial={initial} mode="purchasing" initialSearch="missing material" />);
  expect(screen.getByRole('searchbox', { name: 'Search purchasing' })).toHaveValue('missing material');
  rerender(<GlobalSupplyPage workspaceId="workspace" initial={initial} mode="inventory" />);
  expect(screen.getByRole('searchbox', { name: 'Search inventory' })).toHaveValue('');
  expect(within(screen.getByRole('table', { name: 'Workspace inventory' })).getByText('MR plywood')).toBeVisible();
});

it('does not show warehouse balances to a project viewer without inventory access', () => {
  render(<GlobalSupplyPage workspaceId="workspace" initial={{...initial,canBuy:false,canViewInventory:false,stock:[]}} mode="inventory"/>);
  expect(screen.getByText('Inventory is available to purchasing and project managers.')).toBeVisible();
  expect(screen.queryByRole('table', {name:'Workspace inventory'})).not.toBeInTheDocument();
});

it('retains the failure and offers a retry instead of pretending the queue is empty', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection interrupted')));
  render(<GlobalSupplyPage workspaceId="workspace" initialError="Purchasing records could not be loaded." mode="purchasing"/>);
  expect(screen.getByText('Purchasing records could not be loaded.')).toBeVisible();
  await user.click(screen.getByRole('button', {name:'Retry'}));
  expect(await screen.findByText('Connection interrupted')).toBeVisible();
  vi.unstubAllGlobals();
});
