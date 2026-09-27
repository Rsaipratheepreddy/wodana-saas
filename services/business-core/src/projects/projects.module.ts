import { ProjectRemindersService } from "./project-reminders.service";
import { ProjectNotificationsService } from "./project-notifications";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { UseGuards } from "@nestjs/common";
import { ProjectStockService } from "./project-stock.service";
import { UploadedFile, UseInterceptors, StreamableFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ProjectFilesService } from "./project-files.service";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { Public } from "../auth/public.decorator";
import { AllowWhenReadOnly } from "../auth/tenant-write-block.guard";
import { VendorOrderService } from "./vendor-order.service";
import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentActor } from "../auth/current-actor.decorator";
import { RequestActor } from "../auth/actor";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { HrmsAccessService } from "../hrms/hrms-access.service";
import {
  AssignmentDto,
  PortfolioCalendarQueryDto,
  ScheduleAvailabilityQueryDto,
  WorkLocationDto,
} from "./projects.dto";
import { ProjectAttendanceDto } from "./project-attendance.dto";
import { ExecutionService } from "./execution.service";
import { ProjectsService } from "./projects.service";
import { ProjectWorkflowService } from "./project-workflow.service";
import { ProjectScheduleService } from "./project-schedule.service";
import { ProjectFactoryBatchesService } from "./project-factory-batches.service";
import { CrmNotificationsModule } from "../crm/notifications/crm-notifications.module";
import { RestoreConfigurationRevisionDto } from "../workspaces/dto/restore-configuration-revision.dto";
@ApiTags("projects-sites")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/projects")
export class ProjectsController {
  constructor(
    private readonly service: ProjectsService,
    private readonly execution: ExecutionService,
    private readonly vendor: VendorOrderService,
    private readonly files: ProjectFilesService,
    private readonly stock: ProjectStockService,
    private readonly workflows: ProjectWorkflowService,
    private readonly schedule: ProjectScheduleService,
    private readonly factoryBatches: ProjectFactoryBatchesService,
  ) {}
  @Get("factory-batches")
  listFactoryBatches(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Query("projectId") projectId?:string){
    return this.factoryBatches.state(actor,workspaceId,projectId);
  }
  @Post("factory-batches")
  factoryBatchCommand(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() body:unknown){
    return this.factoryBatches.command(actor,workspaceId,body);
  }
  @Get("workflow-templates")
  workflowTemplates(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.workflows.list(actor, workspaceId);
  }
  @Put("workflow-templates/:templateId")
  saveWorkflowTemplate(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("templateId", ParseUUIDPipe) templateId: string,
    @Body() body: unknown,
  ) {
    return this.workflows.save(actor, workspaceId, templateId, body);
  }
  @Post("workflow-templates/:templateId/archive")
  archiveWorkflowTemplate(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("templateId", ParseUUIDPipe) templateId: string,
    @Body() body: unknown,
  ) {
    return this.workflows.archive(actor, workspaceId, templateId, body);
  }
  @Get("workflow-templates/:templateId/history")
  workflowTemplateHistory(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("templateId", ParseUUIDPipe) templateId: string,
  ) {
    return this.workflows.history(actor, workspaceId, templateId);
  }
  @Post("workflow-templates/:templateId/rollback")
  rollbackWorkflowTemplate(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("templateId", ParseUUIDPipe) templateId: string,
    @Body() body: RestoreConfigurationRevisionDto,
  ) {
    return this.workflows.rollback(actor, workspaceId, templateId, body);
  }
  @Post(":projectId/files/:recordId/:fileId")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) p: string,
    @Param("recordId") r: string,
    @Param("fileId", ParseUUIDPipe) f: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string },
  ) {
    return this.files.upload(a, w, p, r, f, file);
  }
  @Get(":projectId/files") fileIndex(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) p: string,
  ) {
    return this.files.list(a, w, p);
  }
  @Get(":projectId/files/:fileId") async file(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) p: string,
    @Param("fileId", ParseUUIDPipe) f: string,
  ) {
    const file = await this.files.read(a, w, p, f);
    return new StreamableFile(file.body, {
      type: file.mimeType,
      disposition: "inline",
    });
  }
  @Post(":projectId/vendor-access") vendorAccess(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) p: string,
    @Body() b: unknown,
  ) {
    return this.vendor.issue(a, w, p, b);
  }
  @Get(":projectId/stock") stockState(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) p: string,
  ) {
    return this.stock.state(a, w, p);
  }
  @Post(":projectId/stock") stockCommand(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) p: string,
    @Body() b: unknown,
  ) {
    return this.stock.command(a, w, p, b);
  }
  @Get("approvals") approvals(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query() query: Record<string,unknown>,
  ) { return this.execution.approvalQueue(actor,workspaceId,query); }
  @Get("task-board") taskBoard(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Query() query:Record<string,unknown>){
    return this.execution.taskBoard(actor,workspaceId,query);
  }
  @Get("work-queue") workQueue(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Query() query:Record<string,unknown>){
    return this.execution.workQueue(actor,workspaceId,query);
  }
  @Get("supply-queue") supplyQueue(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string){
    return this.execution.supplyQueue(actor,workspaceId);
  }
  @Get("portfolio") portfolio(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.execution.list(actor, w);
  }
  @Get("calendar") portfolioCalendar(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() query: PortfolioCalendarQueryDto,
  ) {
    return this.execution.portfolioCalendar(actor, w, query);
  }
  @Get("schedule/availability") scheduleAvailability(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query() query: ScheduleAvailabilityQueryDto,
  ) {
    return this.schedule.availability(actor, workspaceId, query);
  }
  @AllowWhenReadOnly() @Post(":projectId/bookings/preview") previewBooking(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() body: unknown,
  ) {
    return this.schedule.preview(actor, workspaceId, projectId, body);
  }
  @Put(":projectId/bookings") saveBooking(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() body: unknown,
  ) {
    return this.schedule.save(actor, workspaceId, projectId, body);
  }
  @Post(":projectId/bookings/:taskId/cancel") cancelBooking(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.schedule.cancel(actor, workspaceId, projectId, taskId, body);
  }
  @Post(":projectId/bookings/:taskId/complete") completeBooking(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    return this.schedule.complete(actor, workspaceId, projectId, taskId, body);
  }
  @Get("candidates") candidates(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.execution.candidates(actor, w);
  }
  @Get("field-queue") fieldQueue(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.execution.fieldQueue(actor, w);
  }
  @Post(":projectId/field-actions") fieldAction(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.execution.fieldCommand(actor, w, id, body);
  }
  @Get(":projectId/execution") executionState(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) id: string,
  ) {
    return this.execution.state(actor, w, id);
  }
  @Post(":projectId/execution") executionCommand(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("projectId", ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.execution.command(actor, w, id, body);
  }
  @Get() contexts(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.service.contexts(actor, workspaceId);
  }
  @Get("attendance") siteAttendance(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query() query: ProjectAttendanceDto,
  ) {
    return this.service.siteAttendance(actor, workspaceId, query);
  }
  @Get("assignments") assignments(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.service.assignments(actor, workspaceId);
  }
  @Put("assignments") assign(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() body: AssignmentDto,
  ) {
    return this.service.assign(actor, workspaceId, body);
  }
  @Get("locations") locations(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.service.locations(actor, workspaceId);
  }
  @Put("locations") saveLocation(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() body: WorkLocationDto,
  ) {
    return this.service.saveLocation(actor, workspaceId, body);
  }
}
@Public()
@Controller("vendor-order")
export class VendorOrderController {
  constructor(private readonly vendor: VendorOrderService) {}
  @Post() action(@Body() b: unknown) {
    return this.vendor.handle(b);
  }
}
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/projects/reminders")
class InternalProjectRemindersController {
  constructor(private readonly reminders: ProjectRemindersService) {}
  @Post() send() {
    return this.reminders.send();
  }
}

@Module({
  imports: [WorkspacesModule, CrmNotificationsModule],
  controllers: [
    InternalProjectRemindersController,
    ProjectsController,
    VendorOrderController,
  ],
  providers: [
    ProjectRemindersService,
    ProjectNotificationsService,
    InternalServiceGuard,
    ProjectStockService,
    ProjectsService,
    ExecutionService,
    VendorOrderService,
    ProjectFilesService,
    BrandAssetStorageService,
    HrmsAccessService,
    ProjectWorkflowService,
    ProjectScheduleService,
    ProjectFactoryBatchesService,
  ],
  exports: [ProjectsService, ProjectNotificationsService],
})
export class ProjectsModule {}
