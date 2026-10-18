import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CalendarDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsString() @MaxLength(80) timezone: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays: number[];
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) dayStart = "09:00";
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) halfDay = "13:00";
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) dayEnd = "18:00";
}
export class CalendarUpdateDto extends CalendarDto {
  @IsInt() @Min(1) version: number;
}
export class HolidayDto {
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) startsOn: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) endsOn: string;
}
export class HolidayUpdateDto extends HolidayDto {
  @IsInt() @Min(1) version: number;
}
export class VersionDto {
  @IsInt() @Min(1) version: number;
}
export class SettingsDto {
  @IsInt() @Min(0) version: number;
  @IsUUID() defaultCalendarId: string;
  @IsOptional() @IsUUID() fallbackApproverId?: string | null;
  @IsInt() @Min(5) @Max(500) maxGpsAccuracyM = 100;
  @IsInt() @Min(30) @Max(600) maxCaptureAgeSeconds = 120;
  @IsInt() @Min(30) @Max(3650) mediaRetentionDays = 365;
  /** Document kinds a person needs to go on site; left out, the current choice stays. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(["identity", "work_permit", "residence", "licence", "insurance", "safety_induction", "medical", "other"], { each: true })
  siteDocuments?: string[];
}
export class EmployeeDto {
  @IsInt() @Min(0) version: number;
  @IsBoolean() enabled = true;
  @IsString() @MaxLength(40) employeeCode = "";
  @IsString() @MaxLength(120) designation = "";
  @IsString() @MaxLength(120) department = "";
  @IsOptional() @IsUUID() managerId?: string | null;
  @IsUUID() calendarId: string;
  @IsBoolean() remoteAllowed = false;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) activeFrom: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) activeTo?: string | null;
}
export class CaptureDto {
  @IsUUID() id: string;
}
export class PositionDto {
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsNumber() @Min(0) @Max(100000) accuracyM: number;
  @IsDateString() capturedAt: string;
  @IsBoolean() mock = false;
}
export class AttendanceActionDto {
  @IsUUID() actionId: string;
  @IsUUID() captureId: string;
  @IsIn(["check_in", "check_out", "switch"]) kind:
    | "check_in"
    | "check_out"
    | "switch";
  @IsOptional() @IsUUID() expectedSessionId?: string | null;
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
  @IsIn(["office", "site", "field", "remote"]) mode:
    | "office"
    | "site"
    | "field"
    | "remote";
  @IsOptional() @IsUUID() locationId?: string | null;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() caseId?: string | null;
  @IsDateString() deviceAt: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => PositionDto)
  position?: PositionDto | null;
  @IsString() @MaxLength(2000) note = "";
  @IsString() @MaxLength(2000) exceptionReason = "";
}
export class HistoryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
  @IsOptional() @IsUUID() membershipId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsIn(["self", "team"]) scope: "self" | "team" = "self";
}
export class ReviewDto {
  @IsUUID() actionId: string;
  @IsUUID() sessionId: string;
  @IsIn(["correction", "missing_checkout"]) kind:
    | "correction"
    | "missing_checkout";
  @IsOptional() @IsUUID() eventId?: string;
  @IsDateString() requestedAt: string;
  @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
export class DecisionDto {
  @IsIn(["approve", "reject"]) decision: "approve" | "reject";
  @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
export class LeaveTypeDto {
  @IsOptional() @IsUUID() id?: string;
  @IsInt() @Min(0) version: number;
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsBoolean() limited = true;
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(366) annualDays: number;
  @IsBoolean() allowHalfDay = true;
  @IsBoolean() paid = true;
  @IsBoolean() active = true;
}
export class AllowanceDto {
  @IsUUID() membershipId: string;
  @IsUUID() leaveTypeId: string;
  @IsInt() @Min(2000) @Max(2200) year: number;
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(366) days: number;
  @IsInt() @Min(0) version: number;
}
export class LeaveDto {
  @IsUUID() actionId: string;
  @IsUUID() leaveTypeId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate: string;
  @IsIn(["full", "first_half", "second_half"]) dayPart:
    | "full"
    | "first_half"
    | "second_half";
  @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
export class CancelLeaveDto {
  @IsString() @MinLength(3) @MaxLength(2000) reason: string;
}
export class LeaveQueryDto {
  @IsOptional() @IsIn(["self", "team"]) scope: "self" | "team" = "self";
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
}

export class CrewDto {
  @IsOptional() @IsUUID() id?: string;
  @IsInt() @Min(0) version: number;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsString() @MinLength(1) @MaxLength(80) trade: string;
  @IsOptional() @IsUUID() vendorId?: string | null;
  @IsOptional() @IsUUID() leadMembershipId?: string | null;
  @IsBoolean() active = true;
}
export class WorkerDto {
  @IsOptional() @IsUUID() id?: string;
  @IsInt() @Min(0) version: number;
  @IsString() @MinLength(1) @MaxLength(120) name: string;
  @IsString() @MinLength(1) @MaxLength(80) trade: string;
  @IsOptional() @IsUUID() crewId?: string | null;
  @IsString() @MaxLength(40) workerCode = "";
  @IsString() @MaxLength(40) phone = "";
  @IsOptional() @Matches(/^\d{1,14}(\.\d{1,4})?$/) dayRate?: string | null;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string | null;
  @IsBoolean() active = true;
}
export class CrewDayWorkerDto {
  @IsUUID() workerId: string;
  @IsIn(["present", "half_day", "absent"]) presence: "present" | "half_day" | "absent";
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(16) overtimeHours = 0;
}
export class CrewDayDto {
  @IsInt() @Min(0) version: number;
  @IsUUID() crewId: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate: string;
  @IsString() @MaxLength(2000) note = "";
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CrewDayWorkerDto)
  workers: CrewDayWorkerDto[];
}
export class CrewDaySubmitDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsUUID() captureId?: string | null;
  @IsOptional()
  @ValidateNested()
  @Type(() => PositionDto)
  position?: PositionDto | null;
  @IsString() @MaxLength(2000) exceptionReason = "";
}
export class CrewDayDecisionDto {
  @IsInt() @Min(1) version: number;
  @IsIn(["approve", "return"]) decision: "approve" | "return";
  @IsString() @MaxLength(2000) note = "";
}
export class CrewDayQueryDto {
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class DocumentDto {
  @IsInt() @Min(0) version: number;
  @IsOptional() @IsUUID() membershipId?: string | null;
  @IsOptional() @IsUUID() workerId?: string | null;
  @IsIn(["identity", "work_permit", "residence", "licence", "insurance", "safety_induction", "medical", "other"]) kind:
    | "identity" | "work_permit" | "residence" | "licence" | "insurance" | "safety_induction" | "medical" | "other";
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsString() @MaxLength(80) number = "";
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) issuedOn?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresOn?: string | null;
  @IsString() @MaxLength(2000) note = "";
}
export class DocumentQueryDto {
  @IsOptional() @IsUUID() membershipId?: string;
  @IsOptional() @IsUUID() workerId?: string;
}
export class SiteAccessDto {
  @IsUUID() projectId: string;
  @IsOptional() @IsUUID() crewId?: string | null;
  @IsOptional() @IsUUID() workerId?: string | null;
  @IsOptional() @IsUUID() membershipId?: string | null;
}
export class SiteAccessQueryDto {
  @IsUUID() projectId: string;
}

export class TimeEntryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) workDate: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() stageId?: string | null;
  @IsInt() @Min(1) @Max(1440) minutes: number;
  @IsString() @MaxLength(500) note = "";
}
export class TimeWeekDto {
  @IsInt() @Min(0) version: number;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TimeEntryDto)
  entries: TimeEntryDto[];
}
export class TimeDecisionDto {
  @IsInt() @Min(1) version: number;
  @IsIn(["approve", "return"]) decision: "approve" | "return";
  @IsString() @MaxLength(2000) note = "";
}
export class DateQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
}
export class RangeQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to: string;
}
export class ProjectHoursQueryDto {
  @IsUUID() projectId: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class PayrollQueryDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month: string;
  @IsOptional() @IsIn(["employees", "workers"]) kind: "employees" | "workers" = "employees";
}
