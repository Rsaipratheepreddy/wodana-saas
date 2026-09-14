import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { CreateWorkspaceDto } from "./create-workspace.dto";

export class CreateOrganizationRequestDto extends CreateWorkspaceDto {
  @ApiPropertyOptional({ description: "Business reason for the additional organization" })
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : String(value).trim())
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class VersionedOrganizationRequestDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ApproveOrganizationRequestDto extends VersionedOrganizationRequestDto {
  @ApiPropertyOptional({
    minimum: 1,
    description: "Explicitly raise the account limit when the current limit has been reached",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  organizationLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === undefined ? undefined : String(value).trim())
  @IsString()
  @MaxLength(500)
  decisionReason?: string;
}

export class RejectOrganizationRequestDto extends VersionedOrganizationRequestDto {
  @ApiProperty()
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  decisionReason!: string;
}

export class UpdateCustomerAccountLimitDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  organizationLimit!: number;
}

export class ListOrganizationRequestsQueryDto {
  @ApiPropertyOptional({ enum: ["pending", "approved", "rejected", "cancelled"] })
  @IsOptional()
  @IsIn(["pending", "approved", "rejected", "cancelled"])
  status?: "pending" | "approved" | "rejected" | "cancelled";
}
