import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { OperatorRequest } from "./platform-operator.guard";
import type { PlatformOperatorPermission } from "./platform-operator-policy";

export const PLATFORM_OPERATOR_PERMISSION_KEY = "platform-operator-permission";

export const RequireOperatorPermission = (permission: PlatformOperatorPermission) =>
  SetMetadata(PLATFORM_OPERATOR_PERMISSION_KEY, permission);

@Injectable()
export class PlatformOperatorPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const permission = this.reflector.getAllAndOverride<PlatformOperatorPermission>(
      PLATFORM_OPERATOR_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!permission) throw new ForbiddenException("Operator permission policy is missing for this route");
    const operator = context.switchToHttp().getRequest<OperatorRequest>().platformOperator;
    if (!operator?.permissions.includes(permission)) {
      throw new ForbiddenException(`Operator permission required: ${permission}`);
    }
    return true;
  }
}
