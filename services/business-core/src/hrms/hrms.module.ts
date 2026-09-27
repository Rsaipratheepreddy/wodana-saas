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
  DecisionDto,
  EmployeeDto,
  HistoryDto,
  HolidayDto,
  HolidayUpdateDto,
  LeaveDto,
  LeaveQueryDto,
  LeaveTypeDto,
  ReviewDto,
  SettingsDto,
  VersionDto,
  WorkerDto,
} from "./hrms.dto";
import { HrmsCrewsService } from "./hrms-crews.service";
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
  ) {}
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
    BrandAssetStorageService,
  ],
})
export class HrmsModule {}
