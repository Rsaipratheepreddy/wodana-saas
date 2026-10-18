import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  IsUUID,
} from "class-validator";

const passwordMessage =
  "Password must be 10-128 characters and include uppercase, lowercase, number, and symbol";

export class LocalLoginDto {
  @ApiProperty({ format: "email", example: "admin@igloarchitects.com" })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ format: "password", example: "IgloDemo#2026" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    example: "iglo-architects",
    description: "Omit to sign in by email alone; several active workspaces return a picker instead of a session",
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === "" ? undefined : String(value).trim().toLowerCase()))
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  tenantSlug?: string;

  @ApiPropertyOptional({ format: "uuid", description: "Log out one of this user's devices before retrying sign-in" })
  @IsOptional()
  @IsUUID()
  revokeFamilyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  currentRefreshToken?: string;

}

export class ResolveOrganizationDto {
  @ApiProperty({ example: "Palm Living", description: "Organization name, sign-in slug, or workspace ID" })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  identifier!: string;
}

export class ActivateInvitationDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  invitationToken!: string;

  @ApiProperty({ format: "password" })
  @IsString()
  @MinLength(10, { message: passwordMessage })
  @MaxLength(128, { message: passwordMessage })
  @Matches(/[a-z]/, { message: passwordMessage })
  @Matches(/[A-Z]/, { message: passwordMessage })
  @Matches(/[0-9]/, { message: passwordMessage })
  @Matches(/[^A-Za-z0-9]/, { message: passwordMessage })
  password!: string;
}

export class RefreshSessionDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  refreshToken?: string;
}

export class SessionSecurityDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  refreshToken!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  workspaceId!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ format: "email" })
  @Transform(({ value }) => String(value).trim().toLowerCase())
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiPropertyOptional({
    example: "iglo-architects",
    description: "Omit to sign in by email alone; several active workspaces return a picker instead of a session",
  })
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === "" ? undefined : String(value).trim().toLowerCase()))
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  tenantSlug?: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  resetToken!: string;

  @ApiProperty({ format: "password" })
  @IsString()
  @MinLength(10, { message: passwordMessage })
  @MaxLength(128, { message: passwordMessage })
  @Matches(/[a-z]/, { message: passwordMessage })
  @Matches(/[A-Z]/, { message: passwordMessage })
  @Matches(/[0-9]/, { message: passwordMessage })
  @Matches(/[^A-Za-z0-9]/, { message: passwordMessage })
  password!: string;
}

export class VerifyMfaChallengeDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  challengeToken!: string;

  @ApiProperty({ description: "Six-digit authenticator code or one recovery code" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code!: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  revokeFamilyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(256)
  currentRefreshToken?: string;
}

export class MfaWorkspaceQueryDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  workspaceId!: string;
}

export class MfaSessionDto extends SessionSecurityDto {}

export class MfaFactorDto extends SessionSecurityDto {
  @ApiProperty({ description: "Six-digit authenticator code or one recovery code" })
  @Transform(({ value }) => String(value).trim())
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  code!: string;
}
