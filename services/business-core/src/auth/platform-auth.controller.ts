import { Body, Controller, Get, Headers, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Public } from "./public.decorator";
import { PlatformAuthService } from "./platform-auth.service";
import { PlatformChallengeDto, PlatformFactorDto, PlatformLoginDto } from "./dto/platform-auth.dto";

@ApiTags("platform-operator-authentication")
@Public()
@Controller("auth/platform")
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post("login")
  login(@Body() input: PlatformLoginDto, @Req() request: Request) {
    return this.auth.login(input.email, input.password, this.metadata(request));
  }

  @Post("mfa/setup")
  setup(@Body() input: PlatformChallengeDto) {
    return this.auth.startEnrollment(input.challengeToken);
  }

  @Post("mfa/confirm")
  confirm(@Body() input: PlatformFactorDto, @Req() request: Request) {
    return this.auth.confirmEnrollment(input.challengeToken, input.code, this.metadata(request));
  }

  @Post("mfa/verify")
  verify(@Body() input: PlatformFactorDto, @Req() request: Request) {
    return this.auth.verify(input.challengeToken, input.code, this.metadata(request));
  }

  @Get("session")
  session(@Headers("authorization") authorization?: string) {
    return this.auth.session(this.bearerToken(authorization));
  }

  @Post("logout")
  logout(@Headers("authorization") authorization?: string) {
    return this.auth.logout(this.bearerToken(authorization));
  }

  private bearerToken(authorization?: string) {
    if (!authorization?.startsWith("Bearer ")) throw new UnauthorizedException("Operator session is required");
    const token = authorization.slice(7).trim();
    if (!token || token.length > 256) throw new UnauthorizedException("Operator session is required");
    return token;
  }

  private metadata(request: Request) {
    const forwarded = request.headers["x-forwarded-for"];
    return {
      ipAddress: (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0])
        ?.trim() ?? request.ip,
      userAgent: request.headers["user-agent"],
    };
  }
}
