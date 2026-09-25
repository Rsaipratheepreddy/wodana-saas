import {fireEvent,render,screen} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import type {ProjectState,Task} from '@/lib/projects/execution';
import {ProjectInstallationBatches} from './project-installation-batches';
describe('installation batch actions',()=>{
 it('shows production lots with the same independent QC controls',()=>{
  const task={id:'f',location:'factory',ownerId:'maker',assigneeIds:[],status:'in_progress',quantity:4,approved:2,factoryLots:[{id:'lot',title:'First wardrobe',quantity:1,unit:'nos',createdBy:'maker',status:'pending_qc',reviews:[]}]} as unknown as Task;
  const state={memberId:'qc',canManage:true,canReview:true,data:{tasks:[task]}} as unknown as ProjectState;
  const onCreate=vi.fn(),onReview=vi.fn();
  render(<ProjectInstallationBatches state={state} task={task} busy={false} onCreate={onCreate} onReview={onReview} onCancel={vi.fn()}/>);
  expect(screen.getByRole('table',{name:'Production lots'})).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Create lot'}));expect(onCreate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'Pass QC'}));expect(onReview).toHaveBeenCalledWith('lot',true);
 });
 it('exposes independent QC, rework and history without offering excess allocation',()=>{
  const task={id:'t',location:'site',ownerId:'installer',assigneeIds:[],status:'in_progress',quantity:10,approved:2,installationBatches:[{id:'b',title:'First two',quantity:2,unit:'chair',createdBy:'installer',status:'pending_qc',reviews:[]}]} as unknown as Task;
  const state={memberId:'qc',canManage:true,canReview:true,data:{tasks:[task]}} as unknown as ProjectState;
  const onReview=vi.fn(),props={state,task,busy:false,onCreate:vi.fn(),onReview,onCancel:vi.fn()};
  const {rerender}=render(<ProjectInstallationBatches {...props}/>);
  expect(screen.queryByRole('button',{name:'Create batch'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Pass QC'}));expect(onReview).toHaveBeenCalledWith('b',true);
  rerender(<ProjectInstallationBatches {...props} state={{...state,memberId:'installer'}}/>);
  expect(screen.queryByRole('button',{name:'Pass QC'})).toBeNull();
 });
});
