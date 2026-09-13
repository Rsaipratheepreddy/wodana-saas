/** HRMS v1 contracts. Times are ISO instants; calendar dates are YYYY-MM-DD. */
export type WorkMode = "office" | "site" | "field" | "remote";
export type WorkCalendar = {
  id: string;
  name: string;
  timezone: string;
  workingDays: number[];
  holidays: string[];
  dayStart: string;
  halfDay: string;
  dayEnd: string;
};
export type HrmsEmployee = {
  membershipId: string;
  userId: string;
  name: string;
  enabled: boolean;
  remoteAllowed: boolean;
  managerId: string | null;
  activeFrom: string;
  activeTo: string | null;
  calendar: WorkCalendar;
  version: number;
};
export type HrmsPerson = {
  membershipId: string;
  name: string;
  status: string;
  enabled: boolean | null;
  employeeCode: string;
  designation: string;
  department: string;
  managerId: string | null;
  calendarId: string | null;
  remoteAllowed: boolean | null;
  activeFrom: string | null;
  activeTo: string | null;
  version: number;
};
export type HrmsSettings = {
  defaultCalendarId: string;
  fallbackApproverId: string | null;
  maxGpsAccuracyM: number;
  maxCaptureAgeSeconds: number;
  mediaRetentionDays: number;
  version: number;
};
export type HrmsBootstrap = {
  membershipId: string;
  employee: HrmsEmployee | null;
  settings: HrmsSettings | null;
  calendars: WorkCalendar[];
  workspace: { name: string; timezone: string };
  permissions: {
    self: boolean;
    team: boolean;
    manage: boolean;
    evidence: boolean;
    manageProjects: boolean;
  };
};
export type WorkContext = {
  id: string;
  name: string;
  kind: "project" | "pre_project";
  canViewAttendance?: boolean;
  status: string;
  caseId: string;
  customerName: string;
};
export type WorkLocation = {
  id: string;
  name: string;
  kind: "office" | "site";
  projectId: string | null;
  caseId: string | null;
  address: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  active: boolean;
  version: number;
};
export type ProjectAssignment = {
  id: string;
  projectId: string | null;
  caseId: string | null;
  membershipId: string;
  isManager: boolean;
  active: boolean;
};
export type CapturePosition = {
  latitude: number;
  longitude: number;
  accuracyM: number;
  capturedAt: string;
  mock: boolean;
};
export type AttendanceAction = {
  actionId: string;
  captureId: string;
  kind: "check_in" | "check_out" | "switch";
  expectedSessionId?: string | null;
  expectedVersion?: number;
  mode: WorkMode;
  locationId?: string | null;
  projectId?: string | null;
  caseId?: string | null;
  deviceAt: string;
  position: CapturePosition | null;
  note: string;
  exceptionReason: string;
};
export type WorkSegment = {
  id: string;
  sessionId?: string;
  mode: WorkMode;
  locationId: string | null;
  projectId: string | null;
  caseId: string | null;
  context: { name: string; location: WorkLocation | null };
  startedAt: string;
  endedAt: string | null;
  startEventId?: string;
  endEventId?: string | null;
};
export type AttendanceSession = {
  id: string;
  membershipId?: string;
  name?: string;
  startedAt: string;
  endedAt: string | null;
  calendar: WorkCalendar;
  version: number;
  segments: WorkSegment[];
  pendingReviewCount: number;
  rejectedReviewCount: number;
};
export type LocationEvidence = {
  status: string;
  distanceM: number | null;
  accuracyM: number | null;
};
export type AttendanceEvidence = {
  position: CapturePosition | null;
  location: WorkLocation | null;
  arrival?: LocationEvidence;
  departure?: LocationEvidence | null;
  photoCaptured: boolean;
  issues?: string[];
  verification: string;
  exceptionReason?: string;
};
export type AttendanceEvent = {
  id: string;
  sessionId: string;
  kind: string;
  originalAt: string;
  effectiveAt: string;
  receivedAt: string;
  deviceAt: string;
  captureId: string | null;
  evidence: AttendanceEvidence;
  note: string;
};
export type AttendanceDay = {
  membershipId: string;
  name: string;
  date: string;
  timezone: string;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  elapsedMinutes: number;
  open: boolean;
  stale: boolean;
  reviewCount: number;
  rejectedCount: number;
  leaveDays: number;
  leaveStatus: string | null;
  status: string;
  breakdown: { name: string; mode: string; minutes: number }[];
};
export type AttendanceReview = {
  id: string;
  membershipId: string;
  name?: string;
  sessionId: string;
  eventId: string | null;
  kind: string;
  reason: string;
  status: string;
  requestedAt: string | null;
  originalAt?: string | null;
  decisionReason: string | null;
  createdAt: string;
  canDecide?: boolean;
  captureId?: string | null;
  evidence?: AttendanceEvidence;
};
export type AttendanceHistory = {
  from: string;
  to: string;
  sessions: AttendanceSession[];
  segments: WorkSegment[];
  events: AttendanceEvent[];
  reviews: AttendanceReview[];
  days: AttendanceDay[];
};
export type LeaveType = {
  id: string;
  name: string;
  annualDays: number;
  allowHalfDay: boolean;
  active: boolean;
  version: number;
};
export type LeaveBalance = {
  membershipId: string;
  name: string;
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  allowance: number;
  used: number;
  pending: number;
  available: number;
  version: number;
};
export type LeaveRequest = {
  id: string;
  membershipId: string;
  name: string;
  leaveTypeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  dayPart: "full" | "first_half" | "second_half";
  days: number;
  reason: string;
  status: string;
  decisionReason: string | null;
  cancellationReason: string | null;
  createdAt: string;
  version: number;
  canDecide: boolean;
};

export type ProjectSiteAttendance = {
  id: string;
  name: string;
  site: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  locationStatus: string;
  minutes: number | null;
};
