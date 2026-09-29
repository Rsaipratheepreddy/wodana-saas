import { ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from "class-validator";
import { SALES_ENQUIRY_STATUSES } from "./sales-enquiry.domain";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class SalesEnquiryUtmDto {
  @IsOptional() @IsString() @MaxLength(150) source?: string;
  @IsOptional() @IsString() @MaxLength(150) medium?: string;
  @IsOptional() @IsString() @MaxLength(150) campaign?: string;
  @IsOptional() @IsString() @MaxLength(150) term?: string;
  @IsOptional() @IsString() @MaxLength(150) content?: string;
}

/** The public "Contact sales" submission. `website` is the honeypot; `elapsedMs` is the time spent on the form. */
export class SubmitSalesEnquiryDto {
  @IsUUID() requestId!: string;
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(254) email!: string;
  @IsOptional() @IsString() @MaxLength(200) company?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) countryCode?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z]{2}$/) phoneCountry?: string;
  @IsOptional() @IsString() @MaxLength(40) teamSize?: string;
  @IsOptional() @IsString() @MaxLength(4000) message?: string;
  @IsBoolean() consent!: boolean;
  @IsOptional() @IsString() @MaxLength(500) website?: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(604_800_000) elapsedMs!: number;
  @IsOptional() @IsString() @Matches(/^[a-z0-9_-]{1,40}$/) source?: string;
  @IsOptional() @IsString() @MaxLength(300) pagePath?: string;
  @IsOptional() @IsString() @MaxLength(500) referrer?: string;
  @IsOptional() @ValidateNested() @Type(() => SalesEnquiryUtmDto) utm?: SalesEnquiryUtmDto;
  @IsOptional() @IsString() @MaxLength(35) locale?: string;
}

export class ListSalesEnquiriesQueryDto {
  @ApiPropertyOptional({ enum: SALES_ENQUIRY_STATUSES }) @IsOptional() @IsIn([...SALES_ENQUIRY_STATUSES]) status?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(160) search?: string;
}

export class ChangeSalesEnquiryStatusDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsIn([...SALES_ENQUIRY_STATUSES]) status!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string;
}

export class AssignSalesEnquiryDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @ValidateIf((input: AssignSalesEnquiryDto) => input.assigneeUserId !== null) @IsUUID() assigneeUserId!: string | null;
}

export class AddSalesEnquiryNoteDto {
  @IsUUID() noteId!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) body!: string;
}

export class SaveSalesContactFormDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsObject() configuration!: Record<string, unknown>;
}
