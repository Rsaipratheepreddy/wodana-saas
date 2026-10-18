import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { Public } from "../auth/public.decorator";
import { CatalogModule } from "../catalog/catalog.module";
import { InventoryModule } from "../inventory/inventory.module";
import { PurchasingModule } from "../purchasing/purchasing.module";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { LinkedImportsService } from "./linked-imports.service";
import { SheetSourceService } from "./sheet-source.service";

/** Linked spreadsheet imports for stock, the catalog and suppliers. Bodies are validated in the service. */
@ApiTags("linked-imports")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/linked-imports")
export class LinkedImportsController {
  constructor(private readonly imports: LinkedImportsService) {}

  @Get()
  overview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: Record<string, unknown>) {
    return this.imports.overview(actor, workspaceId, query ?? {});
  }

  @Post("source")
  source(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: Record<string, unknown>) {
    return this.imports.readSource(actor, workspaceId, body ?? {});
  }

  @Post("preview")
  preview(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: Record<string, unknown>) {
    return this.imports.preview(actor, workspaceId, body ?? {});
  }

  @Post()
  apply(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() body: Record<string, unknown>) {
    return this.imports.apply(actor, workspaceId, body ?? {});
  }

  @Get(":linkId")
  detail(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("linkId", ParseUUIDPipe) linkId: string) {
    return this.imports.detail(actor, workspaceId, linkId);
  }

  @Post(":linkId/refresh")
  refresh(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("linkId", ParseUUIDPipe) linkId: string, @Body() body: Record<string, unknown>) {
    return this.imports.refresh(actor, workspaceId, linkId, body ?? {});
  }

  @Post(":linkId/settings")
  settings(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("linkId", ParseUUIDPipe) linkId: string, @Body() body: Record<string, unknown>) {
    return this.imports.settings(actor, workspaceId, linkId, body ?? {});
  }
}

/** The schedule: the worker asks every few minutes; due linked sheets refresh. */
@ApiExcludeController()
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/linked-imports")
export class InternalLinkedImportsController {
  constructor(private readonly imports: LinkedImportsService) {}

  @Post("run")
  run() { return this.imports.runDue(); }
}

@Module({
  imports: [WorkspacesModule, InventoryModule, CatalogModule, PurchasingModule],
  controllers: [LinkedImportsController, InternalLinkedImportsController],
  providers: [LinkedImportsService, SheetSourceService, InternalServiceGuard],
})
export class LinkedImportsModule {}
