import {render,screen,fireEvent} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {HomeAttendance} from './home-attendance';
const state=vi.hoisted(()=>({enabled:false,checkedIn:false}));
vi.mock('@/components/hrms/shared',()=>({useHrms:(_workspaceId:string,path:string)=>({data:path==='attendance/current'?{segments:state.checkedIn?[{endedAt:null}]:[]}:{employee:{enabled:state.enabled},permissions:{manage:true}},loading:false,error:''})}));
vi.mock('@/components/hrms/my-attendance',()=>({MyAttendance:()=> <div>Attendance capture</div>}));
it('offers setup rather than check-in when attendance is disabled',()=>{
 state.enabled=false;render(<HomeAttendance workspaceId="w"/>);
 expect(screen.getByRole('link',{name:'Set up attendance'})).toHaveAttribute('href','/workspace/hrms/people');
 expect(screen.queryByRole('button',{name:'Check in'})).not.toBeInTheDocument();
});
it('opens the existing attendance capture for an enabled employee',()=>{
 state.enabled=true;render(<HomeAttendance workspaceId="w"/>);
 fireEvent.click(screen.getByRole('button',{name:'Check in'}));
 expect(screen.getByText('Attendance capture')).toBeInTheDocument();
});
it('offers checkout when an attendance segment is active',()=>{
 state.enabled=true;state.checkedIn=true;render(<HomeAttendance workspaceId="w"/>);
 expect(screen.getByRole('button',{name:'Check out'})).toBeEnabled();
 state.checkedIn=false;
});
