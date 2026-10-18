import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { ManagementReportsService } from "./management-reports.service";

/** Management dashboards (PLM-134): the filter options, each dashboard, the records behind a figure, and the KPI targets. Inputs are validated in the module. */
@ApiTags("management-reports")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/reports/management")
export class ManagementReportsController {
  constructor(private readonly reports: ManagementReportsService) {}

  @Get("options")
  options(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) {
    return this.reports.options(actor, workspaceId);
  }

  @Get("targets")
  targets(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.reports.targets(actor, workspaceId, query?.year);
  }

  @Put("targets")
  saveTargets(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: Record<string, unknown>) {
    return this.reports.saveTargets(actor, workspaceId, body ?? {});
  }

  @Get(":dashboard")
  dashboard(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("dashboard") dashboard: string, @Query() query: Record<string, unknown>) {
    return this.reports.dashboard(actor, workspaceId, dashboard, query ?? {});
  }

  @Get(":dashboard/records")
  records(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("dashboard") dashboard: string, @Query() query: Record<string, unknown>) {
    return this.reports.records(actor, workspaceId, dashboard, query ?? {});
  }
}
