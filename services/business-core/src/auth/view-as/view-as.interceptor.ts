import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import type { AuthenticatedRequest } from "../authenticated-request";
import { runViewingAs } from "./view-as.context";
import { ALLOW_DURING_VIEW_AS_KEY } from "./view-as.decorators";

/**
 * Runs a view-as request's handler inside its session: permission checks narrow to the view's permissions and
 * every database transaction is rolled back instead of committed, so a read can't leave a side effect (no
 * mark-read, no unread reset, no last seen, no default row made on first use). Leaving the view
 * (`@AllowDuringViewAs`) is the one handler that may write.
 */
@Injectable()
export class ViewAsInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const viewAs = context.switchToHttp().getRequest<AuthenticatedRequest>().actor?.viewAs;
    if (!viewAs) return next.handle();
    const writable = this.reflector.getAllAndOverride<boolean>(ALLOW_DURING_VIEW_AS_KEY, [context.getHandler(), context.getClass()]) === true;
    return new Observable((subscriber) => runViewingAs(viewAs, !writable, () => next.handle().subscribe(subscriber)));
  }
}
