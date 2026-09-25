import {render,screen} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {VendorComparison} from './vendor-comparison';
import type {ProjectState} from '@/lib/projects/execution';
it('keeps a cancelled supplier quote visible without labeling it selected',()=>{
 const state={canBuy:true,data:{orders:[{id:'cancelled',number:'RFQ-1',title:'Oak boards',vendor:'Supplier',status:'cancelled',sourceEnquiry:true,materialId:'',taskId:'',quantity:5,unit:'sheet',currency:'INR',vendorUpdates:[]}],materials:[],tasks:[],workPackages:[]}} as unknown as ProjectState;
 render(<VendorComparison state={state} onChoose={vi.fn()} onForm={vi.fn()} onEdit={vi.fn()}/>);
 expect(screen.getByText('Cancelled',{exact:true})).toBeVisible();expect(screen.queryByText('Selected',{exact:true})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Select quote'})).not.toBeInTheDocument();
});
