import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { DesignDecisionsService } from "./design-decisions.service";
import { CONFIRMATION_METHODS, LEDGER_KINDS, LEDGER_SOURCES } from "./design-ledger.domain";
import { DECISION_SOURCES } from "./design-journey.domain";

const optional = () => ValidateIf((_, value) => value !== null && value !== undefined);

class OptionDto {
  @IsUUID() id!: string;
  @IsString() @MinLength(1) @MaxLength(240) title!: string;
  @IsOptional() @optional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @optional() @IsUUID() designId?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(2000) @Matches(/^https:\/\//) linkUrl?: string | null;
}
class PresentationDto {
  @IsUUID() id!: string;
  @IsIn(["concepts", "space_planning", "material_selection", "renders"]) stage!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => OptionDto) options!: OptionDto[];
}
class VersionDto { @IsInt() @Min(1) version!: number; }
class RoundDecisionDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(["chosen", "changes_requested"]) decision!: "chosen" | "changes_requested";
  @IsOptional() @optional() @IsUUID() optionId?: string | null;
  @IsIn(DECISION_SOURCES as unknown as string[]) source!: string;
  @IsString() @MinLength(1) @MaxLength(200) decidedBy!: string;
  @IsOptional() @optional() @IsString() @MaxLength(2000) note?: string | null;
}
class LedgerFieldsDto {
  @IsString() @MinLength(1) @MaxLength(240) title!: string;
  @IsOptional() @optional() @IsString() @MaxLength(2000) specification?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(200) supplier?: string | null;
  @IsOptional() @optional() @IsString() @Matches(/^\d{1,10}(\.\d{1,4})?$/) quantity?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(40) unit?: string | null;
  @IsOptional() @optional() @IsString() @Matches(/^\d{1,12}(\.\d{1,2})?$/) unitPrice?: string | null;
  @IsOptional() @optional() @IsInt() @Min(-365) @Max(365) timeImpactDays?: number | null;
  @IsIn(LEDGER_SOURCES as unknown as string[]) source!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}T/) saidAt!: string;
  @IsOptional() @optional() @IsUUID() catalogItemId?: string | null;
  @IsOptional() @optional() @IsUUID() evidenceAssetId?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(2000) evidenceNote?: string | null;
  @IsOptional() @optional() @IsString() @MaxLength(2000) note?: string | null;
}
class LedgerEntryDto extends LedgerFieldsDto {
  @IsUUID() id!: string;
  @IsUUID() versionId!: string;
  @IsIn(LEDGER_KINDS as unknown as string[]) kind!: string;
  @IsOptional() @optional() @IsUUID() roomId?: string | null;
}
class LedgerVersionDto extends LedgerFieldsDto { @IsUUID() versionId!: string; @IsInt() @Min(1) entryVersion!: number; }
class ArchiveDto { @IsInt() @Min(1) entryVersion!: number; }
class LedgerDecisionDto {
  @IsIn(["confirmed", "declined"]) decision!: "confirmed" | "declined";
  @IsIn(CONFIRMATION_METHODS as unknown as string[]) method!: string;
  @IsString() @MinLength(1) @MaxLength(200) decidedBy!: string;
  @IsOptional() @optional() @IsString() @MaxLength(2000) note?: string | null;
}
class ApproveChangesDto { @IsInt() @Min(0) lockNumber!: number; @IsOptional() @optional() @IsString() @MaxLength(2000) note?: string | null;
  @IsOptional() @IsIn(["approve", "return", "reject"]) decision?: "approve" | "return" | "reject"; @IsOptional() @optional() @IsUUID() commandId?: string | null;
  @IsOptional() @optional() @IsInt() @Min(1) approvalVersion?: number | null; }

@ApiTags("design")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/pre-projects/:caseId")
export class DesignDecisionsController {
  constructor(private readonly decisions: DesignDecisionsService) {}

  @Get("design-presentations")
  presentations(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) { return this.decisions.presentations(actor, workspaceId, caseId); }

  @Post("design-presentations")
  create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: PresentationDto) { return this.decisions.createPresentation(actor, workspaceId, caseId, input); }

  @Post("design-presentations/:id/present")
  present(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: VersionDto) { return this.decisions.present(actor, workspaceId, caseId, id, input); }

  @Post("design-presentations/:id/withdraw")
  withdraw(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: VersionDto) { return this.decisions.withdraw(actor, workspaceId, caseId, id, input); }

  @Post("design-presentations/:id/decision")
  decide(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: RoundDecisionDto) { return this.decisions.decide(actor, workspaceId, caseId, id, input); }

  @Get("design-ledger")
  ledger(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) { return this.decisions.ledger(actor, workspaceId, caseId); }

  @Get("design-ledger/catalog")
  ledgerCatalog(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Query("q") search = "") {
    return this.decisions.ledgerCatalog(actor, workspaceId, caseId, String(search));
  }

  @Post("design-ledger/entries")
  addEntry(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: LedgerEntryDto) { return this.decisions.addEntry(actor, workspaceId, caseId, input); }

  @Post("design-ledger/entries/:entryId/versions")
  addVersion(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("entryId", ParseUUIDPipe) entryId: string, @Body() input: LedgerVersionDto) { return this.decisions.addVersion(actor, workspaceId, caseId, entryId, input); }

  @Post("design-ledger/entries/:entryId/archive")
  archive(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("entryId", ParseUUIDPipe) entryId: string, @Body() input: ArchiveDto) { return this.decisions.archive(actor, workspaceId, caseId, entryId, input); }

  @Post("design-ledger/entries/:entryId/versions/:versionId/decision")
  recordDecision(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Param("entryId", ParseUUIDPipe) entryId: string,
    @Param("versionId", ParseUUIDPipe) versionId: string, @Body() input: LedgerDecisionDto) { return this.decisions.recordDecision(actor, workspaceId, caseId, entryId, versionId, input); }

  @Post("design-ledger/approve-changes")
  approveChanges(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() input: ApproveChangesDto) { return this.decisions.approveChanges(actor, workspaceId, caseId, input); }
}
