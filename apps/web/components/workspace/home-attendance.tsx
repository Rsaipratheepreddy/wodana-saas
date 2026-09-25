"use client";
import {useState} from 'react';
import Link from 'next/link';
import type {AttendanceSession,HrmsBootstrap} from '@wodana/contracts';
import {Button,ControlledModalDialog} from '@/design-system';
import {useHrms} from '@/components/hrms/shared';
import {MyAttendance} from '@/components/hrms/my-attendance';
import s from './workspace-home.module.css';

export function HomeAttendance({workspaceId}:{workspaceId:string}) {
 const [open,setOpen]=useState(false),[revision,setRevision]=useState(0);
 const {data:boot,error,loading}=useHrms<HrmsBootstrap>(workspaceId,'bootstrap',revision);
 const {data:current,error:currentError,loading:currentLoading}=useHrms<AttendanceSession>(workspaceId,'attendance/current',revision);
 const checkedIn=Boolean(current?.segments?.some(segment=>!segment.endedAt));
 return <section className={s.attendance} aria-label="My attendance"><div><strong>Attendance</strong><p>{loading?'Loading attendance…':error?'Attendance could not be loaded.':boot?.employee?.enabled?currentLoading?'Checking current status…':currentError?'Current status unavailable. Open attendance to review.':checkedIn?'Checked in · record your checkout when you finish.':'Not checked in · record your start time.':'Attendance is not enabled for your account.'}</p></div>
 {error?<Button onPress={()=>setRevision(v=>v+1)}>Retry</Button>:!loading&&!boot?.employee?.enabled&&boot?.permissions.manage?<Link href="/workspace/hrms/people">Set up attendance</Link>:<Button variant="primary" isDisabled={loading||!boot?.employee?.enabled} onPress={()=>setOpen(true)}>{currentLoading||currentError?'Open attendance':checkedIn?'Check out':'Check in'}</Button>}
 <Link href="/workspace/hrms/time-summary">Time records</Link>
 <ControlledModalDialog isOpen={open} onOpenChange={setOpen} title="My attendance" size="lg">{boot&&<MyAttendance workspaceId={workspaceId} boot={boot} revision={revision} onSaved={()=>setRevision(v=>v+1)}/>}</ControlledModalDialog>
 </section>;
}
