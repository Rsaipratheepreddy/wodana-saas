import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsEmail, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from "class-validator";
import { CreateWorkspaceDto } from "./create-workspace.dto";
import { ProvisionTenantOwnerDto } from "./provision-tenant.dto";

export class TenantContractContactDto {
  @ApiProperty({ example: "Palm Living Group" })
  @Transform(({ value }) => String(value).trim())
  @IsString() @MinLength(2) @MaxLength(160)
  displayName!: string;

  @ApiProperty({ example: "Cece Serna" })
  @Transform(({ value }) => String(value).trim())
  @IsString() @MinLength(2) @MaxLength(160)
  contactName!: string;

  @ApiProperty({ format: "email", example: "cece@example.com" })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail() @MaxLength(320)
  contactEmail!: string;
}

export class TenantSetupProfileRefDto {
  @ApiProperty({ example: "AE" })
  @Transform(({ value }) => String(value).trim())
  @IsString() @Matches(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)
  code!: string;

  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt() @Min(1)
  version!: number;
}

export class TenantSetupSelectionsDto {
  @ApiProperty({ type: TenantSetupProfileRefDto })
  @ValidateNested() @Type(() => TenantSetupProfileRefDto)
  region!: TenantSetupProfileRefDto;

  @ApiProperty({ type: TenantSetupProfileRefDto })
  @ValidateNested() @Type(() => TenantSetupProfileRefDto)
  firmKit!: TenantSetupProfileRefDto;

  @ApiProperty({ type: TenantSetupProfileRefDto })
  @ValidateNested() @Type(() => TenantSetupProfileRefDto)
  plan!: TenantSetupProfileRefDto;

  @ApiPropertyOptional({ minimum: 1, maximum: 100000, description: "Seats sold, when they differ from the plan's default" })
  @IsOptional() @IsInt() @Min(1) @Max(100000)
  seatLimit?: number;
}

export class CreateTenantProvisioningDraftDto {
  @ApiProperty({ example: "tenant_customer_001" })
  @Transform(({ value }) => String(value).trim())
  @IsString() @MinLength(1) @MaxLength(160)
  externalTenantId!: string;

  @ApiProperty({ type: TenantContractContactDto })
  @ValidateNested() @Type(() => TenantContractContactDto)
  account!: TenantContractContactDto;

  @ApiProperty({ type: CreateWorkspaceDto })
  @ValidateNested() @Type(() => CreateWorkspaceDto)
  organization!: CreateWorkspaceDto;

  @ApiProperty({ type: ProvisionTenantOwnerDto })
  @ValidateNested() @Type(() => ProvisionTenantOwnerDto)
  owner!: ProvisionTenantOwnerDto;

  @ApiProperty({ type: TenantSetupSelectionsDto })
  @ValidateNested() @Type(() => TenantSetupSelectionsDto)
  defaults!: TenantSetupSelectionsDto;
}

export class ProvisionTenantDraftDto {
  @ApiProperty({ minimum: 1 })
  @IsInt() @Min(1)
  expectedVersion!: number;
}
