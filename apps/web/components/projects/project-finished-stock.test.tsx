import {render,screen,fireEvent} from '@testing-library/react';
import {describe,it,expect,vi} from 'vitest';
import {ProjectFinishedStock} from './project-finished-stock';
import {emptyProject} from '../../../../services/business-core/src/projects/execution.domain';
import type {ProjectState,Task} from '@/lib/projects/execution';
describe('factory stock actions',()=>{
 it('opens receipt for in-transit output without claiming it is available',()=>{
  const data=emptyProject();const task={id:'f',title:'Wardrobes',location:'factory',quantity:4,approved:2,unit:'nos',status:'in_progress'} as Task;data.tasks=[task];data.dispatches=[{id:'delivery',taskId:'f',quantity:2,status:'dispatched',accepted:0,rejected:0} as never];
  const onDelivery=vi.fn();render(<ProjectFinishedStock state={{data} as ProjectState} onWork={vi.fn()} onDelivery={onDelivery}/>);
  fireEvent.click(screen.getByRole('button',{name:'Receive at site'}));expect(onDelivery).toHaveBeenCalledWith(task);
 });
 it('gives an honest empty state without invented factory output',()=>{render(<ProjectFinishedStock state={{data:emptyProject()} as ProjectState} onWork={vi.fn()} onDelivery={vi.fn()}/>);expect(screen.getByText(/when manufacturing is planned/)).toBeVisible();expect(screen.queryByRole('table')).not.toBeInTheDocument();});
});
