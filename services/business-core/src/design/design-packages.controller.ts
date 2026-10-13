import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { DesignPackagesService } from "./design-packages.service";

class MinimumDepositDto { @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount!: string; @Matches(/^[A-Z]{3}$/) currency!: string; }
class DesignTimingsDto { @IsInt() @Min(1) @Max(60) inspirationDays!: number; @IsInt() @Min(1) @Max(720) siteVisitHours!: number; }
class DesignSettingsDto {
  @IsOptional() @ValidateNested() @Type(() => MinimumDepositDto) minimumDeposit?: MinimumDepositDto | null;
  @IsOptional() @ValidateNested() @Type(() => DesignTimingsDto) timings?: DesignTimingsDto;
  @IsOptional() @IsInt() @Min(0) version?: number;
}
class DesignPackageDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsString() @MaxLength(40) code!: string;
  @IsString() @MaxLength(120) name!: string;
  @IsIn(["per_space", "per_area", "fixed"]) pricingMethod!: "per_space" | "per_area" | "fixed";
  @Matches(/^\d{1,12}(\.\d{1,2})?$/) rate!: string;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsOptional() @IsIn(["sqft", "sqm"]) areaUnit?: "sqft" | "sqm" | null;
  @IsOptional() @IsInt() @Min(0) @Max(20) includedRevisions?: number;
  @IsOptional() @IsBoolean() includesSpacePlanning?: boolean;
  @IsOptional() @IsBoolean() includesRenders?: boolean;
  @IsOptional() @IsString() @MaxLength(60) requiredRoleCode?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) inclusions?: string | null;
  @IsOptional() @IsInt() @Min(0) position?: number;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(60) reviewRoleCode?: string | null;
  @IsOptional() @IsBoolean() rateFrom?: boolean;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(200) unitDefinition?: string | null;
}
class SiteQuestionDto {
  @IsString() @MinLength(1) @MaxLength(60) @Matches(/^[a-z0-9_-]+$/) key!: string; @IsString() @MinLength(1) @MaxLength(500) question!: string;
  /** PLM-154: the scope the question belongs to (e.g. Kitchen); none for the general ones. */
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(60) scope?: string | null;
}
class StepTimingsDto {
  @IsInt() @Min(1) @Max(30) allocationDays!: number;
  @IsInt() @Min(1) @Max(60) kickoffDays!: number;
  @IsInt() @Min(1) @Max(90) conceptDays!: number;
  @IsInt() @Min(1) @Max(30) siteMeasureDays!: number;
  @IsInt() @Min(1) @Max(365) developmentMinDays!: number;
  @IsInt() @Min(1) @Max(365) developmentMaxDays!: number;
  @IsInt() @Min(0) @Max(90) developmentDaysPerRoom!: number;
  @IsInt() @Min(1) @Max(60) sampleCollectionDays!: number;
  @IsInt() @Min(1) @Max(60) sampleMeetingDays!: number;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(12) conceptOptionsMax!: number | null;
}
const roleKey = () => Matches(/^[a-z][a-z0-9_]{0,63}$/);
class DesignTeamDto {
  @IsString() @roleKey() lead_designer!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @roleKey() junior_designer!: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @roleKey() sales_admin!: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @roleKey() visualiser!: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @roleKey() draftsman!: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @roleKey() material_coordinator!: string | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() @roleKey() technicalLeadRoleCode!: string | null;
}
class DesignFlowSettingsDto {
  @IsInt() @Min(0) version!: number;
  @IsInt() @Min(1) @Max(365) designInternalDays!: number;
  @IsInt() @Min(1) @Max(365) designClientDays!: number;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(365) renderInternalDays?: number | null;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(365) renderClientDays?: number | null;
  @IsInt() @Min(1) @Max(90) materialSelectionDays!: number;
  @IsInt() @Min(1) @Max(90) estimateDays!: number;
  @IsString() @MaxLength(60) visualiserRoleCode!: string;
  @IsOptional() @ValidateIf((_, value) => value !== null) @IsUUID() showroomBookingTypeId!: string | null;
  @IsArray() @ArrayMaxSize(80) @ValidateNested({ each: true }) @Type(() => SiteQuestionDto) siteVisitQuestions!: SiteQuestionDto[];
  @IsOptional() @ValidateNested() @Type(() => StepTimingsDto) steps?: StepTimingsDto;
  @IsOptional() @ValidateNested() @Type(() => DesignTeamDto) team?: DesignTeamDto;
}
class PackageStatusDto { @IsIn(["active", "archived"]) status!: "active" | "archived"; @IsInt() @Min(1) version!: number; }
class QuoteDto { @IsOptional() @IsInt() @Min(1) spaces?: number | null; @IsOptional() @Matches(/^\d{1,9}(\.\d{1,4})?$/) area?: string | null; @IsOptional() @IsIn(["sqft", "sqm"]) areaUnit?: "sqft" | "sqm" | null; }

@ApiTags("design")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/design")
export class DesignPackagesController {
  constructor(private readonly design: DesignPackagesService) {}

  @Get("settings")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.design.get(actor, workspaceId); }

  @Put("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: DesignSettingsDto) {
    return this.design.saveMinimumDeposit(actor, workspaceId, { ...(input.minimumDeposit !== undefined ? { minimumDeposit: input.minimumDeposit } : {}), timings: input.timings, version: input.version });
  }

  @Put("flow-settings")
  saveFlowSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: DesignFlowSettingsDto) {
    return this.design.saveFlowSettings(actor, workspaceId, { ...input, showroomBookingTypeId: input.showroomBookingTypeId ?? null,
      steps: input.steps ? { ...input.steps, conceptOptionsMax: input.steps.conceptOptionsMax ?? null } : undefined,
      team: input.team ? { lead_designer: input.team.lead_designer, junior_designer: input.team.junior_designer ?? null, sales_admin: input.team.sales_admin ?? null,
        visualiser: input.team.visualiser ?? null, draftsman: input.team.draftsman ?? null, material_coordinator: input.team.material_coordinator ?? null,
        technicalLeadRoleCode: input.team.technicalLeadRoleCode ?? null } : undefined });
  }

  @Post("packages")
  save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: DesignPackageDto) {
    return this.design.savePackage(actor, workspaceId, input);
  }

  @Post("packages/:packageId/status")
  status(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("packageId", ParseUUIDPipe) packageId: string, @Body() input: PackageStatusDto) {
    return this.design.setStatus(actor, workspaceId, packageId, input);
  }

  @Post("packages/:packageId/quote")
  quote(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("packageId", ParseUUIDPipe) packageId: string, @Body() input: QuoteDto) {
    return this.design.quote(actor, workspaceId, packageId, input);
  }
}
