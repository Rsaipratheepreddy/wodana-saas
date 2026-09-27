import type {
  AttendanceAction,
  AttendanceHistory,
  AttendanceReview,
  AttendanceSession,
  CalendarInput,
  HolidayInput,
  HrmsBootstrap,
  HrmsCalendar,
  HrmsHoliday,
  HrmsPerson,
  LeaveBalance,
  LeaveRequest,
  LeaveType,
  LeaveTypeInput,
  WorkContext,
  WorkLocation,
} from "@wodana/contracts";
import { hrmsRequest, hrmsUrl } from "./client";

export type Scope = "self" | "team";
export type HistoryQuery = { from: string; to: string; scope?: Scope; membershipId?: string | null; projectId?: string | null };
export type Decision = { decision: "approve" | "reject"; reason: string };
export type ReviewInput = { actionId: string; sessionId: string; kind: "correction" | "missing_checkout"; eventId?: string; requestedAt: string; reason: string };
export type LeaveInput = { actionId: string; leaveTypeId: string; startDate: string; endDate: string; dayPart: LeaveRequest["dayPart"]; reason: string };
export type PersonInput = {
  version: number; enabled: boolean; employeeCode: string; designation: string; department: string; managerId: string | null; calendarId: string; remoteAllowed: boolean;
  activeFrom: string; activeTo: string | null;
};
export type AllowanceInput = { membershipId: string; leaveTypeId: string; year: number; days: number; version: number };
export type SettingsInput = {
  version: number; defaultCalendarId: string; fallbackApproverId: string | null; maxGpsAccuracyM: number; maxCaptureAgeSeconds: number; mediaRetentionDays: number;
};
export type LocationInput = {
  id?: string; version: number; name: string; kind: WorkLocation["kind"]; projectId: string | null; caseId: string | null; address: string; latitude: number; longitude: number;
  radiusM: number; active: boolean;
};

const query = (values: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};
const historyQuery = (input: HistoryQuery) => query({ from: input.from, to: input.to, scope: input.scope, membershipId: input.membershipId, projectId: input.projectId });

/** HRMS for one workspace, through the web proxy: attendance, leave, people, calendars and workplaces. */
export function hrmsApi(workspaceId: string) {
  const get = <T>(path: string, area = "hrms") => hrmsRequest<T>(workspaceId, path, "GET", undefined, area);
  const send = <T>(method: "POST" | "PUT", path: string, body: unknown, area = "hrms") => hrmsRequest<T>(workspaceId, path, method, body, area);
  return {
    bootstrap: () => get<HrmsBootstrap>("bootstrap"),
    /** The open attendance session, or null when checked out. */
    current: () => get<AttendanceSession | null>("attendance/current"),
    history: (input: HistoryQuery) => get<AttendanceHistory>(`attendance/history${historyQuery(input)}`),
    exportUrl: (input: HistoryQuery) => hrmsUrl(workspaceId, `attendance/export${historyQuery(input)}`),
    photoUrl: (captureId: string) => hrmsUrl(workspaceId, `captures/${captureId}/photo`),
    startCapture: (id: string) => send<unknown>("POST", "captures", { id }),
    uploadPhoto: (id: string, photo: Blob) => {
      const form = new FormData();
      form.append("photo", photo, "camera.jpg");
      return send<unknown>("PUT", `captures/${id}/photo`, form);
    },
    act: (input: AttendanceAction) => send<{ current?: AttendanceSession | null } | null>("POST", "attendance/actions", input),
    reviews: (scope: Scope) => get<AttendanceReview[]>(`reviews${query({ scope })}`),
    requestReview: (input: ReviewInput) => send<unknown>("POST", "reviews", input),
    decideReview: (id: string, input: Decision) => send<unknown>("POST", `reviews/${id}/decision`, input),
    leaveTypes: () => get<LeaveType[]>("leave/types"),
    saveLeaveType: (input: LeaveTypeInput) => send<unknown>("PUT", "leave/types", input),
    balances: (scope: Scope, year: number) => get<LeaveBalance[]>(`leave/balances${query({ scope, year })}`),
    saveAllowance: (input: AllowanceInput) => send<unknown>("PUT", "leave/allowances", input),
    /** Leave requests; every year when none is given. */
    leaveRequests: (scope: Scope, year?: number) => get<LeaveRequest[]>(`leave/requests${query({ scope, year })}`),
    requestLeave: (input: LeaveInput) => send<{ id: string; status: string }>("POST", "leave/requests", input),
    cancelLeave: (id: string, reason: string) => send<unknown>("POST", `leave/requests/${id}/cancel`, { reason }),
    decideLeave: (id: string, input: Decision) => send<unknown>("POST", `leave/requests/${id}/decision`, input),
    people: () => get<HrmsPerson[]>("people"),
    savePerson: (membershipId: string, input: PersonInput) => send<unknown>("PUT", `people/${membershipId}`, input),
    saveSettings: (input: SettingsInput) => send<unknown>("PUT", "settings", input),
    calendars: () => get<HrmsCalendar[]>("calendars"),
    createCalendar: (input: CalendarInput) => send<HrmsCalendar>("POST", "calendars", input),
    updateCalendar: (id: string, input: CalendarInput & { version: number }) => send<HrmsCalendar>("PUT", `calendars/${id}`, input),
    addHoliday: (calendarId: string, input: HolidayInput) => send<HrmsHoliday>("POST", `calendars/${calendarId}/holidays`, input),
    updateHoliday: (id: string, input: HolidayInput & { version: number }) => send<HrmsHoliday>("PUT", `holidays/${id}`, input),
    removeHoliday: (id: string, version: number) => send<{ id: string }>("POST", `holidays/${id}/remove`, { version }),
    locations: () => get<WorkLocation[]>("locations", "projects"),
    saveLocation: (input: LocationInput) => send<unknown>("PUT", "locations", input, "projects"),
    /** Projects and planning cases the person can work on. */
    contexts: () => get<WorkContext[]>("", "projects"),
  };
}
export type HrmsApi = ReturnType<typeof hrmsApi>;
