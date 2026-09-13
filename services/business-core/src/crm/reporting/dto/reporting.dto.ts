import { IsIn, IsOptional, IsString } from "class-validator";
export class ReportRangeQueryDto {
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(["source", "mainSource", "channel", "enquiryType", "customerType", "budget", "owner", "team", "intake", "day", "week", "month"])
  groupBy?: string;
}
