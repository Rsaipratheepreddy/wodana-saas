import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {ProjectOrderAmendments} from './project-order-amendments';
import type {Order,ProjectState} from '@/lib/projects/execution';
const amendment={id:'a',status:'submitted',createdBy:'buyer',reviewerId:'reviewer',dueDate:'2026-09-24',createdAt:'2026-09-22',reason:'Rate revised',evidence:'Q2',before:{quantity:5,unitCost:10,promisedDate:'2026-09-25',currency:'AED'},after:{unitCost:12,promisedDate:'2026-09-28'}} as NonNullable<Order['amendments']>[number];
const order={id:'o',status:'approved',receipts:[],amendments:[amendment]} as unknown as Order;
const state={canBuy:true,canReview:true,memberId:'reviewer',data:{financeClosed:false}} as ProjectState;
it('allows proposer or manager recovery while preserving collapsed assignment history',()=>{
 const onReassign=vi.fn();const assigned={...amendment,assignments:[{fromReviewerId:'old',toReviewerId:'reviewer',fromDueDate:'2026-09-23',toDueDate:'2026-09-24',by:'manager',at:'2026-09-22',reason:'Reviewer on leave'}]};
 const props={order:{...order,amendments:[assigned]},busy:false,onPropose:vi.fn(),onDecide:vi.fn(),onReassign};
 const {rerender}=render(<ProjectOrderAmendments {...props} state={{...state,memberId:'buyer'}}/>);
 fireEvent.click(screen.getByRole('button',{name:'Reassign reviewer'}));expect(onReassign).toHaveBeenCalledWith(assigned);expect(screen.getByText('Reviewer history (1)')).toBeTruthy();
 rerender(<ProjectOrderAmendments {...props} state={state}/>);expect(screen.queryByRole('button',{name:'Reassign reviewer'})).toBeNull();
 rerender(<ProjectOrderAmendments {...props} state={{...state,canManage:true}}/>);expect(screen.getByRole('button',{name:'Reassign reviewer'})).toBeTruthy();
});
it('shows before/after impact and independent reviewer actions',()=>{const onDecide=vi.fn();render(<ProjectOrderAmendments state={state} order={order} busy={false} onPropose={vi.fn()} onDecide={onDecide}/>);expect(screen.getByRole('table',{name:'Order amendment history'})).toBeTruthy();expect(screen.getByText('Rate revised')).toBeTruthy();expect(screen.getByText('Q2')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Approve amendment'}));expect(onDecide).toHaveBeenCalledWith(amendment,'approved');expect(screen.queryByRole('button',{name:'Propose amendment'})).toBeNull();});
it('shows withdrawal to proposer and blocks approval after fulfilment',()=>{const {rerender}=render(<ProjectOrderAmendments state={{...state,memberId:'buyer'}} order={order} busy={false} onPropose={vi.fn()} onDecide={vi.fn()}/>);expect(screen.getByRole('button',{name:'Withdraw'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Approve amendment'})).toBeNull();rerender(<ProjectOrderAmendments state={state} order={{...order,receipts:[{} as never]}} busy={false} onPropose={vi.fn()} onDecide={vi.fn()}/>);expect(screen.getByRole('button',{name:'Approve amendment'})).toBeDisabled();expect(screen.getByRole('button',{name:'Reject'})).toBeEnabled();});
