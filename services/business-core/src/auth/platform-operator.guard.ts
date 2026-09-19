import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PlatformAuthService } from "./platform-auth.service";
import type { PlatformOperatorPermission, PlatformOperatorRole } from "./platform-operator-policy";

export type OperatorRequest = Request & {
  platformOperator?: {
    userId: string;
    email: string;
    displayName: string;
    role: PlatformOperatorRole;
    permissions: PlatformOperatorPermission[];
  };
};

@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<OperatorRequest>();
    const token = request.header("x-wodana-operator-session")?.trim();
    if (!token || token.length > 256) throw new UnauthorizedException("Operator session is required");
    const session = await this.auth.session(token);
    request.platformOperator = {
      userId: session.userId,
      email: session.email,
      displayName: session.displayName,
      role: session.role,
      permissions: session.permissions,
    };
    return true;
  }
}
