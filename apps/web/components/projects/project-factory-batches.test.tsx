import {fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ProjectFactoryBatches} from './project-factory-batches';
afterEach(()=>vi.unstubAllGlobals());
const data={canManage:true,batches:[],resources:[],members:[],candidates:[]};
describe('factory batch board',()=>{
 it('offers retry after a failure without implying an empty factory',async()=>{
  const fetch=vi.fn().mockRejectedValueOnce(Error('Unavailable')).mockResolvedValue({ok:true,json:async()=>data});vi.stubGlobal('fetch',fetch);
  render(<ProjectFactoryBatches workspaceId="workspace"/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');expect(screen.queryByText('No factory batches')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Refresh batches'}));expect(await screen.findByText('No factory batches')).toBeTruthy();
 });
 it('preserves an unfinished create draft when closed and reopened',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>data}));render(<ProjectFactoryBatches workspaceId="workspace"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Create batch'}));fireEvent.change(screen.getByRole('textbox',{name:'Batch name'}),{target:{value:'Wardrobes run'}});
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));fireEvent.click(screen.getByRole('button',{name:'Create batch'}));
  expect(screen.getByRole('textbox',{name:'Batch name'})).toHaveValue('Wardrobes run');
 });
 it('requests a scoped project view without exposing creation actions',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({...data,canManage:false})});vi.stubGlobal('fetch',fetch);
  render(<ProjectFactoryBatches workspaceId="workspace" projectId="project"/>);await screen.findByText('No factory batches');
  expect(fetch.mock.calls[0][0]).toContain('projectId=project');expect(screen.queryByRole('button',{name:'Create batch'})).toBeNull();
 });
});
