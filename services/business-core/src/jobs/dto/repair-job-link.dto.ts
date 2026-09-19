import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from "class-validator";

export class RepairJobLinkDto {
  @IsIn(["enquiry", "lead", "opportunity", "case", "quote", "project"])
  recordType!: "enquiry" | "lead" | "opportunity" | "case" | "quote" | "project";

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  recordId!: string;

  @IsOptional()
  @IsUUID()
  caseId?: string;

  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @IsUUID()
  requestId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  reason!: string;
}
