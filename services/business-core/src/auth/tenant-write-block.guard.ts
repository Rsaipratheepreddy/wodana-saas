import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { DatabaseService } from "../database/database.service";
import { IS_PUBLIC_KEY } from "./public.decorator";

export const ALLOW_WHEN_READ_ONLY_KEY = "allowWhenReadOnly";

/** Marks a POST that only reads (an export or a preview), so a suspended organization can still use it. */
export const AllowWhenReadOnly = () => SetMetadata(ALLOW_WHEN_READ_ONLY_KEY, true);

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export const ORGANIZATION_READ_ONLY = "organization_read_only";
export const ORGANIZATION_ARCHIVED = "organization_archived";

export function writeBlockFor(status: string | undefined) {
  if (status === "suspended") {
    return new HttpException({
      statusCode: HttpStatus.LOCKED,
      code: ORGANIZATION_READ_ONLY,
      message: "This organization is read-only while it is suspended. You can still read and export your records.",
    }, HttpStatus.LOCKED);
  }
  if (status === "archived") {
    return new ForbiddenException({ code: ORGANIZATION_ARCHIVED, message: "This organization is archived." });
  }
  return null;
}

/**
 * A suspended organization keeps its reads and exports but refuses every change (423 with a reason).
 * It runs for every signed-in request to a `workspaces/:workspaceId/...` route after the auth guard.
 */
@Injectable()
export class TenantWriteBlockGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext) {
    if (context.getType() !== "http") return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const request = context.switchToHttp().getRequest<Request>();
    if (READ_METHODS.has(request.method.toUpperCase())) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_READ_ONLY_KEY, targets)) return true;
    const workspaceId = request.params?.workspaceId;
    if (typeof workspaceId !== "string" || !UUID.test(workspaceId)) return true;
    const found = await this.database.tenantTransaction(workspaceId, SERVICE_ACTOR_ID, (client) =>
      client.query<{ status: string }>("SELECT status::text FROM workspaces WHERE id = $1", [workspaceId]));
    const blocked = writeBlockFor(found.rows[0]?.status);
    if (blocked) throw blocked;
    return true;
  }
}
