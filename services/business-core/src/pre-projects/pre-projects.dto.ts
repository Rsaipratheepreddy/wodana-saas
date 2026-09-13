import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export class ListPreProjectsDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(["all", "qualified", "active", "released", "archived"]) status?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
}
export class StartPreProjectDto { @IsUUID() opportunityId!: string; }

export class StartFromQualifiedLeadDto {
  @IsUUID() leadId!: string;
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsString() @MaxLength(60) nextActionAt?: string;
}
