import { ApiProperty } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { CreateWorkspaceDto } from "./create-workspace.dto";

export class ProvisionTenantOwnerDto {
  @ApiProperty({ format: "email", example: "owner@palmlivingae.com" })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: "Operations Owner" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;
}

export class ProvisionTenantDto extends CreateWorkspaceDto {
  @ApiProperty({
    description: "Stable tenant identifier from the internal administration portal",
    example: "tenant_palmliving_001",
  })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  externalTenantId!: string;

  @ApiProperty({ type: ProvisionTenantOwnerDto })
  @ValidateNested()
  @Type(() => ProvisionTenantOwnerDto)
  owner!: ProvisionTenantOwnerDto;
}
