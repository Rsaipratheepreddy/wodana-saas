import { Controller, Param, ParseUUIDPipe, Sse, type MessageEvent } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { interval, map, merge, takeUntil, timer, type Observable } from "rxjs";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { LiveEventsService, toMessage } from "./live-events.service";

/** A stream closes after this long; the browser reconnects, and access is checked again. */
export const LIVE_STREAM_MINUTES = 15;

@ApiTags("events")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/events")
export class LiveEventsController {
  constructor(private readonly live: LiveEventsService, private readonly access: WorkspaceAccessService) {}

  /**
   * Server-sent events: `change` with the scopes that changed ("workspace", "notifications", "sales",
   * "projects", "project:<id>", "conversation:<id>", "purchasing", "factory", "approvals"), and a `ping` every
   * 25 seconds. No record data is sent; screens re-read their own rows.
   */
  @Sse()
  async stream(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string): Promise<Observable<MessageEvent>> {
    await this.access.asMember(actor, workspaceId, async () => undefined);
    return merge(
      this.live.stream(workspaceId).pipe(toMessage),
      interval(25_000).pipe(map(() => ({ type: "ping", data: { connected: this.live.connected } }))),
    ).pipe(takeUntil(timer(LIVE_STREAM_MINUTES * 60_000)));
  }
}
