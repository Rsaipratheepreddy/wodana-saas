import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { CrmReportingService } from "./crm-reporting.service";
import { ReportRangeQueryDto } from "./dto/reporting.dto";
@ApiTags("crm-reporting") @ApiBearerAuth() @Controller("workspaces/:workspaceId/crm/reports")
export class CrmReportingController {
  constructor(private readonly reporting: CrmReportingService) {}
  @Get(":report") report(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("report") report: string, @Query() query: ReportRangeQueryDto) { return this.reporting.report(actor, workspaceId, report, query); }
}
