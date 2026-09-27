import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AttendanceEvidence, AttendanceHistory, AttendanceReview, AttendanceSession, CrewDay, CrewDays, HrmsBootstrap, HrmsCrewState, HrmsDocuments,
  LeaveBalance, LeaveRequest, LeaveType, MyTimeWeek, PendingTimeWeeks, SiteAccess, TimeWeek, WorkContext, WorkLocation,
} from '../../../../../packages/contracts/src/hrms';
import { useApi } from '../../core/api';
import { useSession } from '../../core/session';

export type * from '../../../../../packages/contracts/src/hrms';

/** Attendance history also lists the leave in the range (not in the shared contract yet). */
export type HistoryLeave = { id: string; membershipId: string; startDate: string; endDate: string; dayPart: string; units: Array<{ date: string; part: string; days: number }>; status: string; name: string };
export type AttendanceHistoryWithLeave = AttendanceHistory & { leaves?: HistoryLeave[] };
export type ActionResult = { event: { id: string; sessionId: string; occurredAt: string; evidence: AttendanceEvidence }; current: AttendanceSession | null; replayed: boolean };
export type CommandReceipt = { id: string; status: string; replayed?: boolean };

/** Every HRMS query key starts with the workspace, so switching workspaces never shows another's data. */
export const hrmsKeys = {
  all: (ws: string) => ['hrms', ws] as const,
  bootstrap: (ws: string) => ['hrms', ws, 'bootstrap'] as const,
  current: (ws: string) => ['hrms', ws, 'current'] as const,
  history: (ws: string, from: string, to: string, scope: 'self' | 'team') => ['hrms', ws, 'history', scope, from, to] as const,
  reviews: (ws: string, scope: 'self' | 'team') => ['hrms', ws, 'reviews', scope] as const,
  leaveTypes: (ws: string) => ['hrms', ws, 'leave-types'] as const,
  balances: (ws: string, scope: 'self' | 'team', year: number) => ['hrms', ws, 'balances', scope, year] as const,
  requests: (ws: string, scope: 'self' | 'team', year?: number) => ['hrms', ws, 'requests', scope, year ?? 'all'] as const,
  time: (ws: string, date: string) => ['hrms', ws, 'time', date] as const,
  pendingTime: (ws: string) => ['hrms', ws, 'time-pending'] as const,
  documents: (ws: string) => ['hrms', ws, 'documents'] as const,
  crews: (ws: string) => ['hrms', ws, 'crews'] as const,
  crewDays: (ws: string, projectId?: string | null) => ['hrms', ws, 'crew-days', projectId ?? 'all'] as const,
  crewDay: (ws: string, id: string) => ['hrms', ws, 'crew-day', id] as const,
  siteAccess: (ws: string, projectId: string) => ['hrms', ws, 'site-access', projectId] as const,
  locations: (ws: string) => ['hrms', ws, 'locations'] as const,
  contexts: (ws: string) => ['hrms', ws, 'contexts'] as const,
};

/** HRMS calls only when the module is open to this person. */
const useOn = () => useSession().has('hrms');

export function useBootstrap() {
  const api = useApi();
  return useQuery({ queryKey: hrmsKeys.bootstrap(api.workspaceId), queryFn: () => api.get<HrmsBootstrap>('hrms/bootstrap'), staleTime: 5 * 60_000, enabled: useOn() });
}

export function useCurrentAttendance(enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: hrmsKeys.current(api.workspaceId), queryFn: () => api.get<AttendanceSession | null>('hrms/attendance/current'), enabled: enabled && on });
}

export function useHistory(from: string, to: string, scope: 'self' | 'team' = 'self', enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({
    queryKey: hrmsKeys.history(api.workspaceId, from, to, scope),
    queryFn: () => api.get<AttendanceHistoryWithLeave>(`hrms/attendance/history?from=${from}&to=${to}&scope=${scope}`),
    enabled: enabled && on,
  });
}

export function useReviews(scope: 'self' | 'team', enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: hrmsKeys.reviews(api.workspaceId, scope), queryFn: () => api.get<AttendanceReview[]>(`hrms/reviews?scope=${scope}`), enabled: enabled && on });
}

export function useLeaveTypes() {
  const api = useApi();
  return useQuery({ queryKey: hrmsKeys.leaveTypes(api.workspaceId), queryFn: () => api.get<LeaveType[]>('hrms/leave/types'), staleTime: 10 * 60_000, enabled: useOn() });
}

export function useBalances(year: number, scope: 'self' | 'team' = 'self') {
  const api = useApi();
  return useQuery({ queryKey: hrmsKeys.balances(api.workspaceId, scope, year), queryFn: () => api.get<LeaveBalance[]>(`hrms/leave/balances?scope=${scope}&year=${year}`), enabled: useOn() });
}

export function useLeaveRequests(scope: 'self' | 'team', year?: number, enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({
    queryKey: hrmsKeys.requests(api.workspaceId, scope, year),
    queryFn: () => api.get<LeaveRequest[]>(`hrms/leave/requests?scope=${scope}${year ? `&year=${year}` : ''}`),
    enabled: enabled && on,
  });
}

export function useMyTime(date: string) {
  const api = useApi();
  return useQuery({ queryKey: hrmsKeys.time(api.workspaceId, date), queryFn: () => api.get<MyTimeWeek>(`hrms/time/mine?date=${date}`), enabled: useOn() });
}

export function usePendingTime(enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: hrmsKeys.pendingTime(api.workspaceId), queryFn: () => api.get<PendingTimeWeeks>('hrms/time/pending'), enabled: enabled && on });
}

export function useDocuments() {
  const api = useApi();
  return useQuery({ queryKey: hrmsKeys.documents(api.workspaceId), queryFn: () => api.get<HrmsDocuments>('hrms/documents'), enabled: useOn() });
}

export function useCrews(enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: hrmsKeys.crews(api.workspaceId), queryFn: () => api.get<HrmsCrewState>('hrms/crews'), enabled: enabled && on, staleTime: 5 * 60_000 });
}

export function useCrewDays(projectId?: string | null, enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({
    queryKey: hrmsKeys.crewDays(api.workspaceId, projectId),
    queryFn: () => api.get<CrewDays>(`hrms/crew-days${projectId ? `?projectId=${projectId}` : ''}`),
    enabled: enabled && on,
  });
}

export function useCrewDay(id: string | null | undefined) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: hrmsKeys.crewDay(api.workspaceId, id ?? ''), queryFn: () => api.get<CrewDay>(`hrms/crew-days/${id}`), enabled: on && !!id });
}

export function useSiteAccess(projectId: string, enabled = true) {
  const api = useApi();
  const on = useOn();
  return useQuery({ queryKey: hrmsKeys.siteAccess(api.workspaceId, projectId), queryFn: () => api.get<SiteAccess>(`hrms/site-access?projectId=${projectId}`), enabled: enabled && on });
}

/** Offices and project sites this person can check in at. */
export function useLocations() {
  const api = useApi();
  return useQuery({ queryKey: hrmsKeys.locations(api.workspaceId), queryFn: () => api.get<WorkLocation[]>('projects/locations'), staleTime: 10 * 60_000 });
}

/** Projects and cases this person works on (the "working on" choice at check-in). */
export function useWorkContexts() {
  const api = useApi();
  return useQuery({ queryKey: hrmsKeys.contexts(api.workspaceId), queryFn: () => api.get<WorkContext[]>('projects'), staleTime: 10 * 60_000 });
}

/** A command that refreshes HRMS afterwards. */
export function useHrmsCommand<Input, Output = CommandReceipt>(run: (api: ReturnType<typeof useApi>, input: Input) => Promise<Output>) {
  const api = useApi();
  const queryClient = useQueryClient();
  const { workspaceId } = useSession();
  return useMutation({
    mutationFn: (input: Input) => run(api, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: hrmsKeys.all(workspaceId) }),
  });
}

export type TimeWeekResult = TimeWeek;
