import { IsOptional, IsString, Matches } from "class-validator";
export class ReportRangeQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  /** A fixed grouping, or "cf:<id>" for one of the workspace's own dropdown enquiry fields. */
  @IsOptional() @Matches(/^(source|mainSource|channel|enquiryType|customerType|budget|emirate|area|owner|team|freshness|intake|day|week|month|cf:[0-9a-f-]{36})$/)
  groupBy?: string;
}
