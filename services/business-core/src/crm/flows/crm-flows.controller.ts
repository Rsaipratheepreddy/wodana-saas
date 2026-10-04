import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { CrmFlowsService } from "./crm-flows.service";
import { AssignEnquiryTypeFlowDto, PublishFlowDto, ValidateFlowDto } from "./dto/flow.dto";

/** Settings › Sales › Flows (plan §5a). */
@ApiTags("crm-flows")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm/flows")
export class CrmFlowsController {
  constructor(private readonly flows: CrmFlowsService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.flows.list(actor, workspaceId);
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
}
