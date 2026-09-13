import { ApiError } from '../auth/client';
import type { AttendanceReview, AttendanceSession, HrmsBootstrap, LeaveRequest } from '../../../../packages/contracts/src/hrms';

export type HrmsDestination = {
  tab: 'attendance' | 'leave' | 'history' | 'approvals';
  reviewView?: 'attendance' | 'leave';
};
export type HomeUpdate = {
  id: string;
  title: string;
  description: string;
  icon: 'check' | 'clock' | 'calendar' | 'hrms';
  tone: 'lilac' | 'rose' | 'peach';
  destination: HrmsDestination;
};
export type HomeUpdatesSnapshot = { items: HomeUpdate[]; partial: boolean; restricted: boolean; timezone?: string };
type Read = <T>(path: string) => Promise<T>;
const dayAt = (now: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
};
const shortDate = (date: string) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

/** Only read sources allowed by bootstrap; failed requests never become zero counts. */
export async function loadHomeUpdates(read: Read, workspaceId: string, now = new Date()): Promise<HomeUpdatesSnapshot> {
  const root = `/workspaces/${workspaceId}/hrms`;
  let boot: HrmsBootstrap;
  try { boot = await read<HrmsBootstrap>(`${root}/bootstrap`); }
  catch (error) {
    if (error instanceof ApiError && error.status === 403) return { items: [], partial: false, restricted: true };
    throw error;
  }
  const timezone = boot.employee?.calendar.timezone ?? boot.workspace.timezone;
  const today = dayAt(now, timezone), year = today.slice(0, 4);
  const self = !!boot.employee?.enabled && boot.permissions.self;
  const [current, ownLeave, reviews, teamLeave] = await Promise.allSettled([
    self ? read<AttendanceSession | null>(`${root}/attendance/current`) : Promise.resolve(undefined),
    self ? read<LeaveRequest[]>(`${root}/leave/requests?scope=self&year=${year}`) : Promise.resolve(undefined),
    boot.permissions.team ? read<AttendanceReview[]>(`${root}/reviews?scope=team`) : Promise.resolve(undefined),
    boot.permissions.team ? read<LeaveRequest[]>(`${root}/leave/requests?scope=team`) : Promise.resolve(undefined),
  ]);
  const partial = [current, ownLeave, reviews, teamLeave].some(result => result.status === 'rejected');
  const ranked: Array<HomeUpdate & { priority: number }> = [];
  if (boot.permissions.team && reviews.status === 'fulfilled' && teamLeave.status === 'fulfilled') {
    const attendance = (reviews.value ?? []).filter(r => r.status === 'pending' && r.canDecide && r.membershipId !== boot.membershipId).length;
    const leave = (teamLeave.value ?? []).filter(r => ['pending', 'cancellation_pending'].includes(r.status) && r.canDecide && r.membershipId !== boot.membershipId).length;
    const count = attendance + leave;
    if (count) ranked.push({ id: 'approvals', priority: 90, icon: 'check', tone: 'lilac',
      title: `${count} request${count === 1 ? ' needs' : 's need'} your review`,
      description: [attendance ? `${attendance} attendance` : '', leave ? `${leave} leave` : ''].filter(Boolean).join(' · '),
      destination: { tab: 'approvals', reviewView: attendance ? 'attendance' : 'leave' } });
  }
  if (self && current.status === 'fulfilled') {
    if (current.value) {
      const stale = now.getTime() - Date.parse(current.value.startedAt) > 36 * 60 * 60 * 1000;
      const time = new Intl.DateTimeFormat('en', { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(new Date(current.value.startedAt));
      ranked.push({ id: 'attendance', priority: stale ? 100 : 80, icon: 'clock', tone: 'peach',
        title: stale ? 'Your checkout needs attention' : 'You’re checked in',
        description: stale ? 'Review your open attendance session' : `Started at ${time} · Open attendance`, destination: { tab: 'attendance' } });
    } else if (boot.employee!.activeFrom <= today && (!boot.employee!.activeTo || boot.employee!.activeTo >= today)) {
      ranked.push({ id: 'attendance', priority: 10, icon: 'clock', tone: 'peach', title: 'Ready for your workday?',
        description: 'Open attendance to check in', destination: { tab: 'attendance' } });
    }
  }
  if (ownLeave.status === 'fulfilled' && ownLeave.value) {
    const upcoming = ownLeave.value.filter(r => r.membershipId === boot.membershipId && r.endDate >= today && ['pending', 'approved', 'cancellation_pending'].includes(r.status))
      .sort((a,b) => a.startDate.localeCompare(b.startDate))[0];
    if (upcoming) {
      const currentLeave = upcoming.status === 'approved' && upcoming.startDate <= today;
      const dates = upcoming.startDate === upcoming.endDate ? shortDate(upcoming.startDate) : `${shortDate(upcoming.startDate)} – ${shortDate(upcoming.endDate)}`;
      ranked.push({ id: `leave-${upcoming.id}`, priority: currentLeave ? 95 : 40, icon: 'calendar', tone: 'rose',
        title: currentLeave ? 'You have approved leave today' : upcoming.status === 'approved' ? 'Your upcoming leave is approved'
          : upcoming.status === 'cancellation_pending' ? 'Leave cancellation pending' : 'Your leave request is pending',
        description: `${dates} · ${upcoming.days} ${upcoming.days === 1 ? 'day' : 'days'}`, destination: { tab: 'leave' } });
    }
  }
  if (!boot.employee?.enabled && boot.permissions.self) ranked.push({ id: 'setup', priority: 5, icon: 'hrms', tone: 'peach',
    title: 'Employee attendance isn’t enabled', description: 'Open HRMS for setup details', destination: { tab: 'attendance' } });
  return { timezone, partial, restricted: false, items: ranked.sort((a,b) => b.priority - a.priority).slice(0,2).map(({ priority: _, ...item }) => item) };
}
