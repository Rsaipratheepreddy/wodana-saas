import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { CrmFlowsService } from "./crm-flows.service";
import { AssignEnquiryTypeFlowDto, CreateFlowDto, PublishFlowDto, ValidateFlowDto } from "./dto/flow.dto";

/** Flows (plan §5a): the top-level screen above Sales. */
@ApiTags("crm-flows")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm/flows")
export class CrmFlowsController {
  constructor(private readonly flows: CrmFlowsService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.flows.list(actor, workspaceId);
  }

  /** The template library a firm picks from when it creates a flow. Declared before `:flowId`. */
  @Get("templates")
  templates(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.flows.templates(actor, workspaceId);
  }

  /** A new flow from a starter, a library template or a copy of one of the workspace's flows. */
  @Post()
  create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateFlowDto) {
    return this.flows.create(actor, workspaceId, input);
  }

  @Post("validate")
  validate(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: ValidateFlowDto) {
    return this.flows.validate(actor, workspaceId, input.definition);
  }

  @Get(":flowId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string, @Query("version") version?: string) {
    const wanted = version === undefined || version === "" ? undefined : Number(version);
    return this.flows.get(actor, workspaceId, flowId, Number.isInteger(wanted) && (wanted as number) > 0 ? wanted : undefined);
  }

  @Post(":flowId/versions")
  publish(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string, @Body() input: PublishFlowDto) {
    return this.flows.publish(actor, workspaceId, flowId, input);
  }

  @Put(":flowId/enquiry-types/:optionId")
  assign(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string,
    @Param("optionId", ParseUUIDPipe) optionId: string, @Body() input: AssignEnquiryTypeFlowDto) {
    return this.flows.assignEnquiryType(actor, workspaceId, flowId, optionId, input);
  }

  /** Takes the enquiry type out of this flow; `version` is the enquiry type's version (DELETE carries no body). */
  @Delete(":flowId/enquiry-types/:optionId")
  unassign(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("flowId", ParseUUIDPipe) flowId: string,
    @Param("optionId", ParseUUIDPipe) optionId: string, @Query("version", ParseIntPipe) version: number) {
    return this.flows.unassignEnquiryType(actor, workspaceId, flowId, optionId, { version });
  }
}
