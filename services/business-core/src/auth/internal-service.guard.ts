import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { Request } from "express";

@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header("x-wodana-internal-token") ?? "";
    const expected = this.config.get<string>("BUSINESS_CORE_INTERNAL_TOKEN", "");

    if (!supplied || !expected || !this.matches(supplied, expected)) {
      throw new UnauthorizedException("Valid internal service credentials are required");
    }
    return true;
  }

  private matches(supplied: string, expected: string): boolean {
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    return suppliedBuffer.length === expectedBuffer.length
      && timingSafeEqual(suppliedBuffer, expectedBuffer);
  }
}
