import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { DesignPackagesService } from "./design-packages.service";

class MinimumDepositDto { @Matches(/^\d{1,12}(\.\d{1,2})?$/) amount!: string; @Matches(/^[A-Z]{3}$/) currency!: string; }
class DesignSettingsDto {
  @IsOptional() @ValidateNested() @Type(() => MinimumDepositDto) minimumDeposit!: MinimumDepositDto | null;
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
}
class PackageStatusDto { @IsIn(["active", "archived"]) status!: "active" | "archived"; @IsInt() @Min(1) version!: number; }
class QuoteDto { @IsOptional() @IsInt() @Min(1) spaces?: number | null; @IsOptional() @Matches(/^\d{1,9}(\.\d{1,4})?$/) area?: string | null; }

@ApiTags("design")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/design")
export class DesignPackagesController {
  constructor(private readonly design: DesignPackagesService) {}

  @Get("settings")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.design.get(actor, workspaceId); }

  @Put("settings")
  saveSettings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: DesignSettingsDto) {
    return this.design.saveMinimumDeposit(actor, workspaceId, { minimumDeposit: input.minimumDeposit ?? null, version: input.version });
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
