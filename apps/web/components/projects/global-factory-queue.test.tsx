import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import type { WorkQueuePage } from '../../../../services/business-core/src/projects/project-work-queue';
import { GlobalFactoryQueue } from './global-factory-queue';

const page:WorkQueuePage={memberId:'member',nextCursor:null,rows:[
  {id:'project:task:job',recordId:'job',projectId:'project',projectName:'Palm Villa',kind:'task',title:'Assemble wardrobe',status:'in_progress',ownerId:'member',ownerName:'Foreman',dueDate:'2026-10-02',href:'/workspace/projects/project/production?record=job',location:'factory',resourceName:'Joinery workshop'},
]};

it('shows factory work as a compact source-linked job table',()=>{
  render(<GlobalFactoryQueue workspaceId="workspace" initial={page} kind="task"/>);
  const table=screen.getByRole('table',{name:'Factory jobs'});
  expect(within(table).getByText('Joinery workshop')).toBeVisible();
  expect(within(table).getByText('In progress')).toBeVisible();
  expect(within(table).getByRole('link',{name:'Open job'})).toHaveAttribute('href',page.rows[0].href);
});

it('gives dispatch its own item table and direct record action',()=>{
  const dispatch={...page.rows[0],id:'project:dispatch:load',recordId:'load',kind:'dispatch' as const,title:'Wardrobe delivery',status:'dispatched',href:'/workspace/projects/project/production?view=dispatch&record=load'};
  render(<GlobalFactoryQueue workspaceId="workspace" initial={{...page,rows:[dispatch]}} kind="dispatch"/>);
  const table=screen.getByRole('table',{name:'Factory dispatches'});
  expect(within(table).getByText('Dispatched')).toBeVisible();
  expect(within(table).getByRole('link',{name:'Open dispatch'})).toHaveAttribute('href',dispatch.href);
});

it('does not carry job rows or their search into Dispatch when the active tab changes',async()=>{
  const user=userEvent.setup();
  const dispatch={...page.rows[0],id:'project:dispatch:load',recordId:'load',kind:'dispatch' as const,title:'Wardrobe delivery',status:'dispatched',href:'/workspace/projects/project/production?view=dispatch&record=load'};
  const {rerender}=render(<GlobalFactoryQueue workspaceId="workspace" initial={page} kind="task"/>);
  await user.type(screen.getByRole('searchbox',{name:'Search factory jobs'}),'wardrobe');
  rerender(<GlobalFactoryQueue workspaceId="workspace" initial={{...page,rows:[dispatch]}} kind="dispatch"/>);
  const table=screen.getByRole('table',{name:'Factory dispatches'});
  expect(screen.getByRole('searchbox',{name:'Search dispatches'})).toHaveValue('');
  expect(within(table).queryByText('Assemble wardrobe')).not.toBeInTheDocument();
  expect(within(table).getByRole('link',{name:'Wardrobe delivery'})).toHaveAttribute('href',dispatch.href);
});
