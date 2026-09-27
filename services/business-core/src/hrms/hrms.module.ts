import {
  Body,
  Controller,
  Get,
  Header,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { BrandAssetStorageService } from "../workspaces/brand-asset-storage.service";
import { ProjectsModule } from "../projects/projects.module";
import {
  AllowanceDto,
  AttendanceActionDto,
  CalendarDto,
  CalendarUpdateDto,
  CancelLeaveDto,
  CaptureDto,
  CrewDayDecisionDto,
  CrewDayDto,
  CrewDayQueryDto,
  CrewDaySubmitDto,
  CrewDto,
  DateQueryDto,
  DecisionDto,
  DocumentDto,
  DocumentQueryDto,
  EmployeeDto,
  HistoryDto,
  HolidayDto,
  HolidayUpdateDto,
  LeaveDto,
  LeaveQueryDto,
  LeaveTypeDto,
  PayrollQueryDto,
  ProjectHoursQueryDto,
  RangeQueryDto,
  ReviewDto,
  SettingsDto,
  SiteAccessDto,
  SiteAccessQueryDto,
  TimeDecisionDto,
  TimeWeekDto,
  VersionDto,
  WorkerDto,
} from "./hrms.dto";
import { HrmsCrewsService } from "./hrms-crews.service";
import { HrmsTimeService } from "./hrms-time.service";
import { HrmsPayrollService } from "./hrms-payroll.service";
import { DOCUMENT_MAX_BYTES, DocumentUpload, HrmsDocumentsService } from "./hrms-documents.service";
import { HrmsAccessService } from "./hrms-access.service";
import { HrmsSettingsService } from "./hrms-settings.service";
import {
  HRMS_PHOTO_MAX_BYTES,
  HrmsAttendanceService,
  PhotoUpload,
} from "./hrms-attendance.service";
import { HrmsLeaveService } from "./hrms-leave.service";
@ApiTags("hrms")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/hrms")
export class HrmsController {
  constructor(
    private readonly settings: HrmsSettingsService,
    private readonly attendance: HrmsAttendanceService,
    private readonly leave: HrmsLeaveService,
    private readonly crewsService: HrmsCrewsService,
    private readonly documentsService: HrmsDocumentsService,
    private readonly timeService: HrmsTimeService,
    private readonly payrollService: HrmsPayrollService,
  ) {}
  @Get("payroll") payroll(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Query() q: PayrollQueryDto) {
    return this.payrollService.month(a, w, q.month);
  }
  @Get("payroll/export")
  @Header("Cache-Control", "private, no-store")
  async payrollExport(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Query() q: PayrollQueryDto) {
    return new StreamableFile(Buffer.from(await this.payrollService.export(a, w, q.month, q.kind), "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="payroll-${q.kind}-${q.month}.csv"`,
    });
  }
  @Get("time/mine") myTime(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Query() q: DateQueryDto) {
    return this.timeService.mine(a, w, q.date);
  }
  @Put("time/weeks/:weekStart") saveWeek(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("weekStart") weekStart: string,
    @Body() b: TimeWeekDto,
  ) {
    return this.timeService.saveWeek(a, w, weekStart, b);
  }
  @Post("time/:id/submit") submitWeek(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: VersionDto,
  ) {
    return this.timeService.submit(a, w, id, b);
  }
  @Post("time/:id/decision") decideWeek(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: TimeDecisionDto,
  ) {
    return this.timeService.decide(a, w, id, b);
  }
  @Get("time/pending") pendingTime(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string) {
    return this.timeService.pending(a, w);
  }
  @Get("time/team") teamTime(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Query() q: DateQueryDto) {
    return this.timeService.team(a, w, q.date);
  }
  @Get("time/project") projectHours(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Query() q: ProjectHoursQueryDto) {
    return this.timeService.projectHours(a, w, q.projectId, q.from, q.to);
  }
  @Get("time/utilisation") utilisation(@CurrentActor() a: RequestActor, @Param("workspaceId", ParseUUIDPipe) w: string, @Query() q: RangeQueryDto) {
    return this.timeService.utilisation(a, w, q.from, q.to);
  }
  @Get("documents") documents(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() q: DocumentQueryDto,
  ) {
    return this.documentsService.documents(a, w, q);
  }
  @Put("documents/:id") saveDocument(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: DocumentDto,
  ) {
    return this.documentsService.saveDocument(a, w, id, b);
  }
  @Put("documents/:id/file")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: DOCUMENT_MAX_BYTES, files: 1 } }))
  documentFile(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: DocumentUpload,
  ) {
    return this.documentsService.uploadFile(a, w, id, file);
  }
  @Get("documents/:id/file")
  @Header("Cache-Control", "private, no-store")
  async documentFileContent(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const file = await this.documentsService.readFile(a, w, id);
    return new StreamableFile(file.body, { type: file.contentType, disposition: `inline; filename="${encodeURIComponent(file.fileName)}"` });
  }
  @Post("documents/:id/remove") removeDocument(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: VersionDto,
  ) {
    return this.documentsService.removeDocument(a, w, id, b);
  }
  @Get("site-access") siteAccess(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() q: SiteAccessQueryDto,
  ) {
    return this.documentsService.siteAccess(a, w, q.projectId);
  }
  @Post("site-access") addSiteAccess(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: SiteAccessDto,
  ) {
    return this.documentsService.addSiteAccess(a, w, b);
  }
  @Post("site-access/:id/remove") removeSiteAccess(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.documentsService.removeSiteAccess(a, w, id);
  }
  @Get("crews") crews(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.crewsService.crews(a, w);
  }
  @Put("crews") saveCrew(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: CrewDto,
  ) {
    return this.crewsService.saveCrew(a, w, b);
  }
  @Put("workers") saveWorker(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: WorkerDto,
  ) {
    return this.crewsService.saveWorker(a, w, b);
  }
  @Get("crew-days") crewDays(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() q: CrewDayQueryDto,
  ) {
    return this.crewsService.crewDays(a, w, q);
  }
  @Get("crew-days/:id") crewDay(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.crewsService.crewDay(a, w, id);
  }
  @Put("crew-days/:id") saveCrewDay(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: CrewDayDto,
  ) {
    return this.crewsService.saveDay(a, w, id, b);
  }
  @Post("crew-days/:id/submit") submitCrewDay(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: CrewDaySubmitDto,
  ) {
    return this.crewsService.submitDay(a, w, id, b);
  }
  @Post("crew-days/:id/decision") decideCrewDay(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: CrewDayDecisionDto,
  ) {
    return this.crewsService.decideDay(a, w, id, b);
  }
  @Get("bootstrap") bootstrap(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.settings.bootstrap(a, w);
  }
  @Get("calendars") calendars(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.settings.calendars(a, w);
  }
  @Post("calendars") calendar(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: CalendarDto,
  ) {
    return this.settings.createCalendar(a, w, b);
  }
  @Put("calendars/:id") updateCalendar(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: CalendarUpdateDto,
  ) {
    return this.settings.updateCalendar(a, w, id, b);
  }
  @Post("calendars/:id/holidays") addHoliday(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: HolidayDto,
  ) {
    return this.settings.addHoliday(a, w, id, b);
  }
  @Put("holidays/:id") updateHoliday(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: HolidayUpdateDto,
  ) {
    return this.settings.updateHoliday(a, w, id, b);
  }
  @Post("holidays/:id/remove") removeHoliday(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: VersionDto,
  ) {
    return this.settings.removeHoliday(a, w, id, b);
  }
  @Put("settings") configure(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: SettingsDto,
  ) {
    return this.settings.saveSettings(a, w, b);
  }
  @Get("people") people(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.settings.people(a, w);
  }
  @Put("people/:id") employee(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: EmployeeDto,
  ) {
    return this.settings.saveEmployee(a, w, id, b);
  }
  @Post("captures") capture(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: CaptureDto,
  ) {
    return this.attendance.capture(a, w, b.id);
  }
  @Put("captures/:id/photo")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("photo", {
      limits: { fileSize: HRMS_PHOTO_MAX_BYTES, files: 1 },
    }),
  )
  photo(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file: PhotoUpload,
  ) {
    return this.attendance.photo(a, w, id, file);
  }
  @Get("captures/:id/photo")
  @Header("Cache-Control", "private, no-store")
  async photoContent(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return new StreamableFile(await this.attendance.readPhoto(a, w, id), {
      type: "image/jpeg",
      disposition: "inline",
    });
  }
  @Get("attendance/current") current(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.attendance.current(a, w);
  }
  @Post("attendance/actions") action(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: AttendanceActionDto,
  ) {
    return this.attendance.action(a, w, b);
  }
  @Get("attendance/history") history(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() q: HistoryDto,
  ) {
    return this.attendance.history(a, w, q);
  }
  @Get("attendance/export")
  @Header("Cache-Control", "private, no-store")
  async export(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() q: HistoryDto,
  ) {
    return new StreamableFile(
      Buffer.from(await this.attendance.export(a, w, q), "utf8"),
      {
        type: "text/csv; charset=utf-8",
        disposition: 'attachment; filename="attendance.csv"',
      },
    );
  }
  @Get("reviews") reviews(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() q: LeaveQueryDto,
  ) {
    return this.attendance.reviews(a, w, q.scope === "team");
  }
  @Post("reviews") review(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: ReviewDto,
  ) {
    return this.attendance.requestReview(a, w, b);
  }
  @Post("reviews/:id/decision") decideReview(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
  ) {
    return this.attendance.decideReview(a, w, id, b);
  }
  @Get("leave/types") types(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
  ) {
    return this.leave.types(a, w);
  }
  @Put("leave/types") saveType(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: LeaveTypeDto,
  ) {
    return this.leave.saveType(a, w, b);
  }
  @Get("leave/balances") balances(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() q: LeaveQueryDto,
  ) {
    return this.leave.balances(a, w, q);
  }
  @Put("leave/allowances") allowance(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: AllowanceDto,
  ) {
    return this.leave.saveAllowance(a, w, b);
  }
  @Get("leave/requests") requests(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Query() q: LeaveQueryDto,
  ) {
    return this.leave.list(a, w, q);
  }
  @Post("leave/requests") request(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Body() b: LeaveDto,
  ) {
    return this.leave.request(a, w, b);
  }
  @Post("leave/requests/:id/cancel") cancel(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: CancelLeaveDto,
  ) {
    return this.leave.cancel(a, w, id, b);
  }
  @Post("leave/requests/:id/decision") decideLeave(
    @CurrentActor() a: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) w: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() b: DecisionDto,
  ) {
    return this.leave.decide(a, w, id, b);
  }
}
@Module({
  imports: [WorkspacesModule, ProjectsModule],
  controllers: [HrmsController],
  providers: [
    HrmsAccessService,
    HrmsSettingsService,
    HrmsAttendanceService,
    HrmsLeaveService,
    HrmsCrewsService,
    HrmsDocumentsService,
    HrmsTimeService,
    HrmsPayrollService,
    BrandAssetStorageService,
  ],
})
export class HrmsModule {}
