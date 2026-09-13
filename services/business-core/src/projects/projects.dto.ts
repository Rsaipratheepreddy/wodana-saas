import {
  IsBoolean,
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
} from "class-validator";
export class ReleaseProjectDto {
  @IsUUID() caseId: string;
}
export class AssignmentDto {
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() caseId?: string;
  @IsUUID() membershipId: string;
  @IsBoolean() isManager = false;
  @IsBoolean() active = true;
}
export class WorkLocationDto {
  @IsOptional() @IsUUID() id?: string;
  @IsInt() @Min(0) version: number;
  @IsString() @MinLength(1) @MaxLength(160) name: string;
  @IsIn(["office", "site"]) kind: "office" | "site";
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() caseId?: string | null;
  @IsString() @MaxLength(500) address = "";
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
  @IsInt() @Min(25) @Max(2000) radiusM = 150;
  @IsBoolean() active = true;
}

export class PortfolioCalendarQueryDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
  @IsOptional() @IsUUID() businessUnitId?: string;
}
