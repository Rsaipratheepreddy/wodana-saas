import { IsInt, IsOptional, IsString, MaxLength, Min, ValidateIf } from "class-validator";

const present = (_: object, value: unknown) => value !== null && value !== undefined;

/**
 * One provider's save. A field left out keeps what is saved; null (or empty) clears it. A secret is
 * replaced by a new value or removed with null, and is never sent back.
 */
export class SavePlatformCredentialsDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @ValidateIf(present) @IsString() @MaxLength(200) clientId?: string | null;
  @IsOptional() @ValidateIf(present) @IsString() @MaxLength(40) configId?: string | null;
  @IsOptional() @ValidateIf(present) @IsString() @MaxLength(8) graphVersion?: string | null;
  @IsOptional() @ValidateIf(present) @IsString() @MaxLength(12) environment?: string | null;
  @IsOptional() @ValidateIf(present) @IsString() @MaxLength(4) dataCenter?: string | null;
  @IsOptional() @ValidateIf(present) @IsString() @MaxLength(200) publicApiBase?: string | null;
  @IsOptional() @ValidateIf(present) @IsString() @MaxLength(256) clientSecret?: string | null;
  @IsOptional() @ValidateIf(present) @IsString() @MaxLength(256) webhookSecret?: string | null;
}
