import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {ProjectDecisionEvidence} from './project-decision-evidence';
import type {ProjectState} from '@/lib/projects/execution';
const state={id:'p',workspaceId:'w',data:{revision:1,files:[{id:'f',recordId:'r',name:'Existing.png'},{id:'other',recordId:'other',name:'Private.png'}]}} as ProjectState;
afterEach(()=>vi.unstubAllGlobals());
describe('decision evidence upload',()=>{
 it('selects only matching record files and updates revision after upload',async()=>{
  const onChange=vi.fn(),onData=vi.fn(),onBusy=vi.fn();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({file:{id:'new'},data:{revision:2,files:[]}})}));
  render(<ProjectDecisionEvidence state={state} recordId="r" selected={['f']} onChange={onChange} onData={onData} busy={false} onBusy={onBusy}/>);
  expect(screen.queryByText('Private.png')).toBeNull();
  fireEvent.change(screen.getByLabelText('Upload image or PDF'),{target:{files:[new File(['image'],'QC.png',{type:'image/png'})]}});
  await waitFor(()=>expect(onData).toHaveBeenCalledWith({revision:2,files:[]}));expect(onChange).toHaveBeenCalledWith(['f','new']);expect(onBusy.mock.calls).toEqual([[true],[false]]);
 });
 it('keeps selection and releases busy state after a rejected upload',async()=>{
  const onChange=vi.fn(),onBusy=vi.fn();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json:async()=>({message:'Upload unavailable'})}));
  render(<ProjectDecisionEvidence state={state} recordId="r" selected={['f']} onChange={onChange} onData={vi.fn()} busy={false} onBusy={onBusy}/>);
  fireEvent.change(screen.getByLabelText('Upload image or PDF'),{target:{files:[new File(['image'],'QC.png',{type:'image/png'})]}});
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toBe('Upload unavailable'));expect(onChange).not.toHaveBeenCalled();expect(onBusy).toHaveBeenLastCalledWith(false);
 });
});
