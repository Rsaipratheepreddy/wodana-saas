import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, ValidateNested } from "class-validator";
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

export class WhatsAppTemplateSyncDto {
  /** True for the daily full list (it marks the sync done); false for one webhook status change. */
  @IsBoolean() full!: boolean;
  @IsArray() @ArrayMaxSize(2000) @ValidateNested({ each: true }) @Type(() => ProviderTemplateDto) templates!: ProviderTemplateDto[];
}
