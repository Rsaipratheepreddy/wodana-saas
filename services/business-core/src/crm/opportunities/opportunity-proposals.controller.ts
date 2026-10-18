import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from "class-validator";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { OpportunityProposalsService } from "./opportunity-proposals.service";

export class SetProposalValueDto {
  @IsString() @Length(1, 24) amount!: string;
  @IsString() @Length(3, 3) currencyCode!: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsOptional() @IsString() @Length(0, 1000) note?: string;
}
export class DecideProposalValueDto {
  @IsIn(["approve", "return", "reject"]) decision!: "approve" | "return" | "reject";
  @IsOptional() @IsString() @Length(0, 1000) note?: string;
  @IsOptional() @IsInt() @Min(1) version?: number;
  @IsOptional() @IsUUID() commandId?: string;
  @IsOptional() @IsBoolean() waive?: boolean;
}
export class RecordFulfilmentDto {
  @IsIn(["collected", "delivered", "installed"]) event!: "collected" | "delivered" | "installed";
  @IsString() @Length(1, 200) receivedBy!: string;
  @IsOptional() @IsString() @Length(0, 1000) note?: string;
  @IsOptional() @IsUUID() commandId?: string;
}
export class SaveClosingRulesDto {
  @IsArray() rules!: Array<{ furniturePath: string | null; closingEvent: string }>;
  @IsOptional() @IsString() versions?: string;
}
export class SaveWonAreasDto {
  @IsArray() @ArrayMaxSize(6) rules!: Array<{ furniturePath: string | null; areas: string[] }>;
  @IsString() versions!: string;
}

/** PLM-101 / PLM-103 / PLM-102: an opportunity's proposals, value approvals (E3), fulfilment and Deal Closed. */
@ApiTags("crm-opportunities")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class OpportunityProposalsController {
  constructor(private readonly proposals: OpportunityProposalsService) {}

  @Get("opportunities/:opportunityId/proposals")
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string) {
    return this.proposals.list(actor, workspaceId, opportunityId);
  }

  @Put("opportunities/:opportunityId/proposals/:kind/value")
  setValue(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Param("kind") kind: string, @Body() input: SetProposalValueDto) {
    return this.proposals.setValue(actor, workspaceId, opportunityId, kind, input);
  }

  @Post("opportunities/:opportunityId/proposals/:kind/decide")
  decide(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Param("kind") kind: string, @Body() input: DecideProposalValueDto) {
    return this.proposals.decide(actor, workspaceId, opportunityId, kind, input);
  }

  @Post("opportunities/:opportunityId/fulfilment")
  fulfil(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("opportunityId", ParseUUIDPipe) opportunityId: string,
    @Body() input: RecordFulfilmentDto) {
    return this.proposals.recordFulfilment(actor, workspaceId, opportunityId, input);
  }

  @Get("flows/:flowId/closing")
  closing(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string) {
    return this.proposals.closingRules(actor, workspaceId, flowId);
  }

  @Put("flows/:flowId/closing")
  saveClosing(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string,
    @Body() input: SaveClosingRulesDto) {
    return this.proposals.saveClosingRules(actor, workspaceId, flowId, input);
  }

  @Get("flows/:flowId/won-areas")
  wonAreas(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string) {
    return this.proposals.wonAreas(actor, workspaceId, flowId);
  }

  @Put("flows/:flowId/won-areas")
  saveWonAreas(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string,
    @Body() input: SaveWonAreasDto) {
    return this.proposals.saveWonAreas(actor, workspaceId, flowId, input);
  }
}
