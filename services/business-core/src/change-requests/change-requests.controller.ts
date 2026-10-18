import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { ChangeRequestsService } from "./change-requests.service";

const object = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});

/** Change requests on a case (plan §6.20, R11): list, raise, assess, send for approval, decide, send to sign, withdraw. */
@ApiTags("change-requests")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/pre-projects/:caseId/change-requests")
export class ChangeRequestsController {
  constructor(private readonly changes: ChangeRequestsService) {}

  @Get() list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string) {
    return this.changes.list(actor, workspaceId, caseId);
  }

  @Post() create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string, @Body() body: unknown) {
    return this.changes.create(actor, workspaceId, caseId, object(body));
  }

  @Put(":id") save(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.changes.save(actor, workspaceId, caseId, id, object(body));
  }

  @Post(":id/submit") submit(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.changes.submit(actor, workspaceId, caseId, id, object(body));
  }

  @Post(":id/decide") decide(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.changes.decide(actor, workspaceId, caseId, id, object(body));
  }

  @Post(":id/send") send(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.changes.send(actor, workspaceId, caseId, id, object(body));
  }

  @Post(":id/withdraw") withdraw(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("caseId", ParseUUIDPipe) caseId: string,
    @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.changes.withdraw(actor, workspaceId, caseId, id, object(body));
  }
}
