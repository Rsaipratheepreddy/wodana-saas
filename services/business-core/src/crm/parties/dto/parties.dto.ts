import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class ListPartiesQueryDto {
  @IsOptional() @IsString() @MaxLength(240) search?: string;
  @IsOptional() @IsIn(["person", "organization", "household"]) type?: string;
  @IsOptional() @IsString() @MaxLength(40) lifecycle?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @Transform(({ value }) => value === true || value === "true") @IsOptional() @IsBoolean() includeArchived?: boolean;
  @IsOptional() @IsString() cursor?: string;
  @Type(() => Number) @IsOptional() @IsInt() @Min(1) @Max(100) limit = 25;
}

export class ContactPointInputDto {
  @ApiProperty({ enum: ["email", "phone", "social", "other"] })
  @IsIn(["email", "phone", "social", "other"]) type!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(500) value!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPrimary?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isVerified?: boolean;
}

export class AddressInputDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsOptional() @IsString() @MaxLength(240) line1?: string;
  @IsOptional() @IsString() @MaxLength(240) line2?: string;
  @IsOptional() @IsString() @MaxLength(160) locality?: string;
  @IsOptional() @IsString() @MaxLength(160) region?: string;
  @IsOptional() @IsString() @MaxLength(40) postalCode?: string;
  @IsString() @Length(2, 2) countryCode!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class CreatePartyDto {
  @ApiProperty({ enum: ["person", "organization", "household"] })
  @IsIn(["person", "organization", "household"]) type!: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(240) displayName!: string;
  @IsOptional() @IsUUID() legalEntityId?: string;
  @IsOptional() @IsUUID() businessUnitId?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string;
  @IsOptional() @IsString() @MaxLength(35) preferredLocale?: string;
  @IsOptional() @IsString() @MaxLength(64) preferredTimezone?: string;
  @IsOptional() @IsString() @MaxLength(120) givenName?: string;
  @IsOptional() @IsString() @MaxLength(120) familyName?: string;
  @IsOptional() @IsString() @MaxLength(160) jobTitle?: string;
  @IsOptional() @IsString() @MaxLength(240) legalName?: string;
  @IsOptional() @IsString() @MaxLength(255) websiteDomain?: string;
  @IsOptional() @IsString() @MaxLength(120) industry?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ContactPointInputDto)
  contacts?: ContactPointInputDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AddressInputDto)
  addresses?: AddressInputDto[];
}

export class UpdatePartyDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(240) displayName?: string;
  @IsOptional() @IsString() @MaxLength(40) lifecycle?: string;
  @IsOptional() @IsUUID() ownerMembershipId?: string | null;
  @IsOptional() @IsString() @MaxLength(35) preferredLocale?: string | null;
  @IsOptional() @IsString() @MaxLength(64) preferredTimezone?: string | null;
  @IsOptional() @IsString() @MaxLength(120) givenName?: string | null;
  @IsOptional() @IsString() @MaxLength(120) familyName?: string | null;
  @IsOptional() @IsString() @MaxLength(160) jobTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(240) legalName?: string | null;
  @IsOptional() @IsString() @MaxLength(255) websiteDomain?: string | null;
  @IsOptional() @IsString() @MaxLength(120) industry?: string | null;
}

export class UpdateContactPointDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) value?: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string | null;
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string | null;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() isVerified?: boolean;
  @IsOptional() @IsIn(["active", "archived"]) status?: string;
}

export class UpdateAddressDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(80) label?: string | null;
  @IsOptional() @IsString() @MaxLength(240) line1?: string | null;
  @IsOptional() @IsString() @MaxLength(240) line2?: string | null;
  @IsOptional() @IsString() @MaxLength(160) locality?: string | null;
  @IsOptional() @IsString() @MaxLength(160) region?: string | null;
  @IsOptional() @IsString() @MaxLength(40) postalCode?: string | null;
  @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class UpdateRelationshipDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(120) label?: string | null;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() endedAt?: string | null;
}

export class ArchivePartyDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ExportPartiesDto {
  @IsOptional() @IsIn(["person", "organization", "household"]) type?: string;
  @IsOptional() @IsString() @MaxLength(40) lifecycle?: string;
  @IsOptional() @IsString() @MaxLength(240) search?: string;
  @IsOptional() @IsBoolean() includeArchived?: boolean;
  @IsOptional() @IsIn(["json", "csv"]) format: "json" | "csv" = "json";
}

export class PrivacyErasePartyDto {
  @IsInt() @Min(1) version!: number;
  @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class CreateRelationshipDto {
  @IsUUID() fromPartyId!: string;
  @IsUUID() toPartyId!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) type!: string;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

export class UpsertConsentDto {
  @IsOptional() @IsUUID() legalEntityId?: string;
  @IsString() @IsNotEmpty() @MaxLength(80) purpose!: string;
  @IsString() @IsNotEmpty() @MaxLength(40) channel!: string;
  @IsIn(["unknown", "granted", "denied", "withdrawn"]) status!: string;
  @IsOptional() @IsObject() evidence?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(20) jurisdiction?: string;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
}

export class MergePartiesDto {
  @IsUUID() survivorPartyId!: string;
  @IsUUID() mergedPartyId!: string;
  @IsObject() fieldDecisions!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ReverseMergeDto {
  @IsInt() @Min(1) survivorVersion!: number;
  @IsInt() @Min(1) mergedVersion!: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class ContactPointResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() rawValue!: string;
  @ApiPropertyOptional({ nullable: true }) normalizedValue!: string | null;
  @ApiProperty() isPrimary!: boolean;
  @ApiProperty() isVerified!: boolean;
}

export class PartyResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() lifecycle!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ minimum: 1 }) version!: number;
  @ApiProperty({ type: [ContactPointResponseDto] }) contacts!: ContactPointResponseDto[];
}
