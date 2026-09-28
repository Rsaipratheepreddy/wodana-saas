import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { STARTER_LANGUAGES } from "../inbox/whatsapp-starter-pack";

export class SubmitStarterPackDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(STARTER_LANGUAGES.length) @IsIn(STARTER_LANGUAGES, { each: true }) languages!: string[];
}

export class TemplateSubmittedDto {
  @IsOptional() @IsString() @MaxLength(100) providerTemplateId?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  /** Why Meta refused the submission (the template is then rejected). */
  @IsOptional() @IsString() @MaxLength(500) error?: string;
}

export class ProviderTemplateDto {
  @IsString() @MaxLength(100) id!: string;
  @IsString() @Matches(/^[a-z0-9_]{1,512}$/) name!: string;
  @IsString() @Matches(/^[a-z]{2,3}(?:_[A-Z]{2})?$/) language!: string;
  @IsString() @MaxLength(40) status!: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsString() @MaxLength(40) quality?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(4096) body?: string;
}

export class UpdateClientMessageDto {
  /** 0 while the event still runs on its defaults. */
  @IsInt() @Min(0) version!: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @Matches(/^[a-z0-9_.-]{1,100}$/) templateCode?: string | null;
}

export class SendPaymentReminderDto {
  @IsUUID() caseId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_.:-]{1,80}$/) paymentId!: string;
}

export class UpdatePaymentReminderScheduleDto {
  @IsInt() @Min(0) version!: number;
  /** Days relative to the due date: negative before it, 0 on it, positive after it. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @IsInt({ each: true }) @Min(-30, { each: true }) @Max(60, { each: true }) offsets!: number[];
}

/** The number's standing at Meta (daily check, or a quality webhook with only some of it). */
export class NumberHealthDto {
  @IsOptional() @IsString() @MaxLength(40) quality?: string | null;
  @IsOptional() @IsString() @MaxLength(40) limit?: string | null;
  @IsOptional() @IsString() @MaxLength(40) status?: string | null;
  @IsOptional() @IsString() @MaxLength(40) event?: string | null;
}

export class WhatsAppTemplateSyncDto {
  /** True for the daily full list (it marks the sync done); false for one webhook status change. */
  @IsBoolean() full!: boolean;
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ProviderTemplateDto) templates!: ProviderTemplateDto[];
  @IsOptional() @ValidateNested() @Type(() => NumberHealthDto) health?: NumberHealthDto;
}
