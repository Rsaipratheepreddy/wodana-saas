import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import {ClientProjectProgress} from './client-project-progress';
import type {PublicProject} from '@/lib/projects/execution';

const project:PublicProject={id:'p',name:'Villa',phase:'active',stage:{key:'installation',name:'Installation'},progress:50,milestones:[],tasks:[{id:'t',title:'Install wardrobe',area:'Bedroom',location:'site',quantity:2,reportedQuantity:2,unit:'nos',status:'awaiting_inspection'}],reports:[{id:'r',date:'2026-09-20',location:'site',tomorrow:'Inspect installation',clientSummary:'Wardrobes installed today.',work:[{title:'Install wardrobe',quantity:2,unit:'nos',status:'awaiting_inspection'}],files:[{id:'photo',name:'Wardrobe.jpg',mimeType:'image/jpeg'}]}],documents:[],handovers:[],warrantyClaims:[]};
describe('client project views',()=>{
 it('removes hidden progress and closes its open record when visibility changes',async()=>{
  const user=userEvent.setup();const props={slug:'studio',handover:<p>Signed handover</p>,onRefresh:vi.fn()};
  const view=render(<ClientProjectProgress {...props} project={project}/>);
  await user.click(screen.getByRole('radio',{name:'Daily updates'}));await user.click(screen.getByRole('button',{name:'View update'}));
  expect(screen.getByRole('link',{name:'Wardrobe.jpg ↗'})).toBeVisible();
  view.rerender(<ClientProjectProgress {...props} project={{...project,clientSections:{progress:false,documents:true,handover:false,updates:false}}}/>);
  expect(screen.queryByRole('radio',{name:'Daily updates'})).toBeNull();expect(screen.queryByRole('radio',{name:'Handover'})).toBeNull();
  expect(screen.queryByRole('link',{name:'Wardrobe.jpg ↗'})).toBeNull();expect(screen.queryByText('Wardrobes installed today.')).toBeNull();
  expect(screen.getByRole('radio',{name:'Documents'})).toHaveAttribute('aria-checked','true');
 });
 it('renders published client updates and does not mount them when disabled',async()=>{
  const user=userEvent.setup();const data={...project,clientSections:{progress:false,documents:false,handover:false,updates:true},clientUpdates:[{id:'u',title:'Delivery rescheduled',summary:'Installation follows on Friday.',kind:'delay' as const,status:'published' as const,publishedAt:'2026-09-22T10:00:00Z',revision:1}]};
  const view=render(<ClientProjectProgress project={data} slug="studio" handover={null} onRefresh={vi.fn()}/>);
  expect(screen.getByRole('heading',{name:'Delivery rescheduled'})).toBeVisible();
  expect(screen.getByText('Installation follows on Friday.')).toBeVisible();
  expect(screen.queryByRole('radio',{name:'Overview'})).toBeNull();
  await user.click(screen.getByRole('radio',{name:'Updates'}));
  view.rerender(<ClientProjectProgress project={{...data,clientSections:{...data.clientSections,updates:false}}} slug="studio" handover={null} onRefresh={vi.fn()}/>);
  expect(screen.queryByText('Delivery rescheduled')).toBeNull();expect(screen.queryByRole('radiogroup')).toBeNull();
 });
 it('shows shared quantities with QC pending and selected evidence in daily updates',async()=>{
  const user=userEvent.setup();const refresh=vi.fn();
  render(<ClientProjectProgress project={project} slug="studio" handover={null} onRefresh={refresh}/>);
  await user.click(screen.getByRole('radio',{name:'Work progress'}));
  await user.click(screen.getByRole('button',{name:'View work'}));
  expect(screen.getByText('2 / 2 nos in shared updates')).toBeVisible();
  expect(screen.getByText('Work is awaiting the quality inspection.')).toBeVisible();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('radio',{name:'Daily updates'}));
  await user.click(screen.getByRole('button',{name:'View update'}));
  expect(screen.getAllByText('Wardrobes installed today.').length).toBeGreaterThan(0);
  expect(screen.getByRole('link',{name:'Wardrobe.jpg ↗'})).toHaveAttribute('href','/api/client-portal/studio/project-files/p/photo');
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button',{name:'Refresh'}));expect(refresh).toHaveBeenCalledOnce();
 });
 it('keeps empty documents and handover explicit without fabricating records',async()=>{
  const user=userEvent.setup();render(<ClientProjectProgress project={project} slug="studio" handover={null} onRefresh={()=>{}}/>);
  await user.click(screen.getByRole('radio',{name:'Documents'}));expect(screen.getByText('No project documents have been shared yet.')).toBeVisible();
  await user.click(screen.getByRole('radio',{name:'Handover'}));expect(screen.getByText('Your handover pack will appear after the work and quality checks are complete.')).toBeVisible();
 });
});
