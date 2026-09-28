import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../public.decorator";
import type { AuthenticatedRequest } from "../authenticated-request";
import { ALLOW_DURING_VIEW_AS_KEY, HIDDEN_DURING_VIEW_AS_KEY } from "./view-as.decorators";
import { viewAsRouteLabel } from "./view-as.domain";
import { ViewAsService } from "./view-as.service";

const READ_METHODS = new Set(["GET", "HEAD"]);

export const VIEW_AS_READ_ONLY = "view_as_read_only";
export const VIEW_AS_PRIVATE = "view_as_private";
export const VIEW_AS_OTHER_WORKSPACE = "view_as_other_workspace";

/**
 * View as (VA-1): runs after sign-in is checked, for every signed-in request. When the viewer's sign-in session
 * has an open view-as session, the request reads as the subject (`actor.viewAs`) and every change is refused
 * with `view_as_read_only`: any method but GET/HEAD, and any route marked as a command. Reads that stay private
 * to the person are refused with `view_as_private`. Only leaving the view is allowed through.
 */
@Injectable()
export class ViewAsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly viewAs: ViewAsService) {}

  async canActivate(context: ExecutionContext) {
    if (context.getType() !== "http") return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.actor) return true;
    const session = await this.viewAs.resolve(request.actor);
    if (!session) return true;
    request.actor.viewAs = session;

    if (this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_VIEW_AS_KEY, targets)) return true;
    const workspaceId = request.params?.workspaceId;
    if (typeof workspaceId === "string" && workspaceId !== session.workspaceId) {
      throw new ForbiddenException({ code: VIEW_AS_OTHER_WORKSPACE, message: "Exit the view to open another workspace." });
    }
    if (!READ_METHODS.has(request.method.toUpperCase())) {
      throw new ForbiddenException({ code: VIEW_AS_READ_ONLY, message: `Read-only while viewing as ${session.subjectName}.` });
    }
    if (this.reflector.getAllAndOverride<boolean>(HIDDEN_DURING_VIEW_AS_KEY, targets)) {
      throw new ForbiddenException({ code: VIEW_AS_PRIVATE, message: `This stays private to ${session.subjectName}.` });
    }
    const page = request.headers["x-wodana-page"];
    const route = viewAsRouteLabel({ method: request.method, path: request.originalUrl ?? request.url, workspaceId: session.workspaceId,
      page: Array.isArray(page) ? page[0] : page });
    if (route) await this.viewAs.recordVisit(session, route);
    return true;
  }
}
