import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { Public } from "../../auth/public.decorator";
import { CrmIntakeService } from "./crm-intake.service";
import { CreateIntakeEventDto, FailIntakeDto, ListEnquiriesQueryDto, ListIntakeQueryDto, ReviewDuplicateDto, UpdateLeadDetailsDto } from "./dto/intake.dto";

@ApiTags("crm-intake")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class CrmIntakeController {
  constructor(private readonly intake: CrmIntakeService) {}

  @Get("lead-options")
  options(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.intake.options(actor, workspaceId);
  }

  @Patch("leads/:leadId/details")
  updateDetails(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: UpdateLeadDetailsDto) {
    return this.intake.updateDetails(actor, workspaceId, leadId, input);
  }

  @Get("intake-events")
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListIntakeQueryDto) {
    return this.intake.list(actor, workspaceId, query);
  }

  @Get("intake-inbox")
  inbox(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListIntakeQueryDto) {
    return this.intake.list(actor, workspaceId, query);
  }

  @Get("enquiries")
  enquiries(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListEnquiriesQueryDto) {
    return this.intake.listEnquiries(actor, workspaceId, query);
  }

  @Get("enquiries/:enquiryId")
  enquiry(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("enquiryId", ParseUUIDPipe) enquiryId: string) {
    return this.intake.getEnquiry(actor, workspaceId, enquiryId);
  }

  @Post("intake-events")
  @ApiOperation({ summary: "Create an idempotent manual or imported CRM intake event" })
  create(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Body() input: CreateIntakeEventDto,
  ) {
    return this.intake.createManual(actor, workspaceId, idempotencyKey, correlationId, input);
  }

  @Get("intake-events/:intakeEventId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("intakeEventId", ParseUUIDPipe) intakeEventId: string) {
    return this.intake.get(actor, workspaceId, intakeEventId);
  }

  @Post("duplicate-candidates/:candidateId/review")
  review(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("candidateId", ParseUUIDPipe) candidateId: string,
    @Body() input: ReviewDuplicateDto,
  ) {
    return this.intake.reviewDuplicate(actor, workspaceId, candidateId, input);
  }
}

@ApiExcludeController()
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/crm")
export class InternalCrmIntakeController {
  constructor(private readonly intake: CrmIntakeService) {}

  @Post("workspaces/:workspaceId/intake-events")
  create(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Body() input: CreateIntakeEventDto,
  ) {
    return this.intake.createInternal(workspaceId, idempotencyKey, correlationId, input);
  }

  @Post("workspaces/:workspaceId/intake-events/:intakeEventId/fail")
  fail(
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("intakeEventId", ParseUUIDPipe) intakeEventId: string,
    @Body() input: FailIntakeDto,
  ) {
    return this.intake.failInternal(workspaceId, intakeEventId, input);
  }
}
