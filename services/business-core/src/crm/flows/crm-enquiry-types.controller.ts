import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { CrmEnquiryTypesService } from "./crm-enquiry-types.service";
import { CreateEnquiryTypeDto, UpdateEnquiryTypeDto } from "./dto/enquiry-type.dto";

/** Enquiry types (plan §5a): the top-level screen above Sales; each type has its own steps. */
@ApiTags("crm-enquiry-types")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm/enquiry-types")
export class CrmEnquiryTypesController {
  constructor(private readonly types: CrmEnquiryTypesService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.types.list(actor, workspaceId);
  }

  /** A new enquiry type with its steps (from a template, a copy of another type's steps, or blank). */
  @Post()
  create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateEnquiryTypeDto) {
    return this.types.create(actor, workspaceId, input);
  }

  @Get(":optionId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("optionId", ParseUUIDPipe) optionId: string, @Query("version") version?: string) {
    const wanted = version === undefined || version === "" ? undefined : Number(version);
    return this.types.get(actor, workspaceId, optionId, Number.isInteger(wanted) && (wanted as number) > 0 ? wanted : undefined);
  }

  /** Rename, recolour, archive or restore. */
  @Patch(":optionId")
  update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("optionId", ParseUUIDPipe) optionId: string, @Body() input: UpdateEnquiryTypeDto) {
    return this.types.update(actor, workspaceId, optionId, input);
  }
}
