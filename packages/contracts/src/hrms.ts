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
  version?: number;
};
/** A named day or run of days off on a calendar (e.g. a three-day public holiday). */
export type HrmsHoliday = {
  id: string;
  calendarId: string;
  name: string;
  startsOn: string;
  endsOn: string;
  days: number;
  version: number;
};
/** A work calendar as its settings show it: its named holidays and how many people follow it. */
export type HrmsCalendar = WorkCalendar & {
  version: number;
  holidayList: HrmsHoliday[];
  people: number;
  isDefault: boolean;
};
export type CalendarInput = {
  name: string;
  timezone: string;
  workingDays: number[];
  dayStart: string;
  halfDay: string;
  dayEnd: string;
};
export type HolidayInput = { name: string; startsOn: string; endsOn: string };
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
  email: string;
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
  /** Document kinds a person needs to go on site. */
  siteDocuments?: HrmsDocumentKind[];
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
    /** Crews: HR, people who run projects, crew leads, and running projects' managers and site supervisors. */
    crews?: boolean;
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
  /** The leave type's name when the day has leave. */
  leaveType: string | null;
  /** A working day on the person's calendar (not a weekend or holiday). */
  scheduled: boolean;
  /** Where the person is working right now, while checked in. */
  place: string | null;
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
/** A kind of leave. Limited types count against a yearly allowance; unlimited ones (sick, unpaid) don't. */
export type LeaveType = {
  id: string;
  name: string;
  limited: boolean;
  annualDays: number;
  allowHalfDay: boolean;
  paid: boolean;
  active: boolean;
  version: number;
};
export type LeaveTypeInput = Omit<LeaveType, "id"> & { id?: string };
export type LeaveBalance = {
  membershipId: string;
  name: string;
  leaveTypeId: string;
  leaveTypeName: string;
  year: number;
  limited: boolean;
  /** Days a year; null for unlimited types. */
  allowance: number | null;
  used: number;
  pending: number;
  /** Days still free to ask for; null for unlimited types. */
  available: number | null;
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

/** H2 — crews and workers without logins. */
export type HrmsCrew = {
  id: string;
  name: string;
  trade: string;
  vendorId: string | null;
  vendorName: string | null;
  leadMembershipId: string | null;
  leadName: string | null;
  active: boolean;
  version: number;
  workers: number;
};
export type HrmsWorker = {
  id: string;
  name: string;
  trade: string;
  crewId: string | null;
  workerCode: string;
  phone: string;
  /** Only for people who run HR. */
  dayRate: string | null;
  currency: string | null;
  active: boolean;
  version: number;
};
export type HrmsCrewState = { crews: HrmsCrew[]; workers: HrmsWorker[]; canManage: boolean };
export type CrewInput = { id?: string; version: number; name: string; trade: string; vendorId?: string | null; leadMembershipId?: string | null; active: boolean };
export type WorkerInput = { id?: string; version: number; name: string; trade: string; crewId?: string | null; workerCode: string; phone: string; dayRate?: string | null; currency?: string | null; active: boolean };
export type CrewPresence = "present" | "half_day" | "absent";
export type CrewDay = {
  id: string;
  crewId: string;
  crewName: string;
  trade: string;
  projectId: string | null;
  projectName: string | null;
  workDate: string;
  status: "draft" | "submitted" | "approved" | "returned";
  markedBy: string;
  markedByName: string;
  captureId: string | null;
  evidence: { position?: CapturePosition | null; site?: { name: string } | null; arrival?: LocationEvidence; photoCaptured?: boolean; issues?: string[] };
  note: string;
  exceptionReason: string;
  submittedAt: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string;
  version: number;
  /** Days of work: a whole day each, half for half a day. */
  present: number;
  workers: Array<{ workerId: string; name: string; trade: string; presence: CrewPresence; overtimeHours: string; dayRate: string | null; currency: string | null }>;
  canMark: boolean;
  canDecide: boolean;
  canSeeCosts?: boolean;
};
/** GET crew-days: the days, and whether (and for which crews) this person may mark one here. */
export type CrewDays = { days: CrewDay[]; canSeeCosts: boolean; canMark: boolean; markableCrewIds: string[] };
export type CrewDayInput = { version: number; crewId: string; projectId?: string | null; workDate: string; note: string; workers: Array<{ workerId: string; presence: CrewPresence; overtimeHours: number }> };
export type CrewDaySubmit = { version: number; captureId?: string | null; position?: CapturePosition | null; exceptionReason: string };

/** H3 — documents with expiry and who may go to each site. */
export type HrmsDocumentKind = "identity" | "work_permit" | "residence" | "licence" | "insurance" | "safety_induction" | "medical" | "other";
export type HrmsDocument = {
  id: string;
  membershipId: string | null;
  workerId: string | null;
  personName?: string;
  kind: HrmsDocumentKind;
  title: string;
  number: string;
  issuedOn: string | null;
  expiresOn: string | null;
  fileName: string | null;
  note: string;
  version: number;
  createdAt: string;
  /** On the workspace's today: expiring means within 30 days. */
  status: "valid" | "expiring" | "expired";
};
export type HrmsDocuments = { documents: HrmsDocument[]; siteDocuments: HrmsDocumentKind[]; canManage: boolean };
export type DocumentInput = { version: number; membershipId?: string | null; workerId?: string | null; kind: HrmsDocumentKind; title: string; number: string; issuedOn?: string | null; expiresOn?: string | null; note: string };
export type SiteClearance = {
  subject: { kind: "member" | "worker"; id: string };
  name: string;
  /** Designation for staff; trade and crew for workers. */
  detail: string;
  cleared: boolean;
  missing: HrmsDocumentKind[];
  expired: HrmsDocumentKind[];
  documents: Array<{ kind: HrmsDocumentKind; title: string; number: string; expiresOn: string | null }>;
};
export type SiteAccess = {
  projectId: string;
  day: string;
  required: HrmsDocumentKind[];
  entries: Array<{ id: string; crewId: string | null; workerId: string | null; membershipId: string | null; name: string }>;
  people: SiteClearance[];
  canManage: boolean;
};
export type SiteAccessInput = { projectId: string; crewId?: string | null; workerId?: string | null; membershipId?: string | null };

/** H4 — studio timesheets and utilisation. */
export type TimeEntry = { id?: string; workDate: string; projectId: string | null; projectName?: string | null; stageId: string | null; stageName?: string | null; minutes: number; note: string };
export type TimeWeek = {
  membershipId: string;
  name: string;
  weekStart: string;
  /** Each day of the week: the minutes the person's calendar expects (less leave) and leave taken. */
  days: Array<{ date: string; scheduledMinutes: number; leaveDays: number }>;
  timesheet: { id: string; status: "draft" | "submitted" | "approved" | "returned"; version: number; submittedAt: string | null; decidedByName: string | null; decisionNote: string } | null;
  entries: TimeEntry[];
  totalMinutes: number;
};
export type MyTimeWeek = TimeWeek & { options: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }> };
/** GET time/pending: every week waiting for this person's decision. */
export type PendingTimeWeeks = { weeks: Array<TimeWeek & { canDecide: boolean }> };
export type TeamTimeWeek = { weekStart: string; people: Array<TimeWeek & { scheduledMinutes: number; canDecide: boolean }> };
export type TimeWeekInput = { version: number; entries: Array<{ workDate: string; projectId?: string | null; stageId?: string | null; minutes: number; note: string }> };
export type ProjectHours = { projectId: string; from: string | null; to: string | null; totalMinutes: number; rows: Array<{ membershipId: string; name: string; stageId: string | null; stageName: string | null; minutes: number }> };
export type Utilisation = { from: string; to: string; people: Array<{ membershipId: string; name: string; scheduledMinutes: number; projectMinutes: number; internalMinutes: number; utilisation: number | null }> };

/** H5 — the month's payroll inputs. */
export type PayrollMonth = {
  month: string;
  from: string;
  to: string;
  people: Array<{ membershipId: string; name: string; employeeCode: string; designation: string; department: string; scheduledDays: number; workedDays: number; workedHours: number;
    overtimeHours: number; paidLeaveDays: number; unpaidLeaveDays: number; absentDays: number; toReview: number }>;
  workers: Array<{ workerId: string; name: string; workerCode: string; trade: string; crew: string | null; days: number; overtimeHours: number; uncosted: number;
    amounts: Array<{ currency: string; amount: string }> }>;
};
