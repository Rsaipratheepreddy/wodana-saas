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
  @IsArray()
  @ArrayMaxSize(366)
  @ArrayUnique()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true })
  holidays: string[] = [];
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) dayStart = "09:00";
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) halfDay = "13:00";
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) dayEnd = "18:00";
}
export class SettingsDto {
  @IsInt() @Min(0) version: number;
  @IsUUID() defaultCalendarId: string;
  @IsOptional() @IsUUID() fallbackApproverId?: string | null;
  @IsInt() @Min(5) @Max(500) maxGpsAccuracyM = 100;
  @IsInt() @Min(30) @Max(600) maxCaptureAgeSeconds = 120;
  @IsInt() @Min(30) @Max(3650) mediaRetentionDays = 365;
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
  @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) @Max(366) annualDays: number;
  @IsBoolean() allowHalfDay = true;
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
