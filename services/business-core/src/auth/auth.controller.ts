import { Body, Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Request } from "express";
import { Public } from "./public.decorator";
import { LocalAuthService } from "./local-auth.service";
import {
  ActivateInvitationDto,
  ForgotPasswordDto,
  LocalLoginDto,
  LogoutDto,
  RefreshSessionDto,
  ResetPasswordDto,
  VerifyMfaChallengeDto,
} from "./dto/local-auth.dto";

@ApiTags("authentication")
@Public()
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: LocalAuthService) {}

  @Get("tenant/:loginSlug")
  @ApiOperation({ summary: "Load public tenant co-branding for the sign-in screen" })
  @ApiOkResponse()
  branding(@Param("loginSlug") loginSlug: string) {
    return this.auth.getTenantBranding(loginSlug);
  }

  @Get("tenant-host/:hostname")
  @ApiOperation({ summary: "Resolve an active, verified custom hostname for sign-in" })
  @ApiOkResponse()
  brandingForHost(@Param("hostname") hostname: string) {
    return this.auth.getTenantBrandingForHost(hostname);
  }

  @Post("login")
  @ApiOperation({ summary: "Sign in with a tenant-scoped local credential" })
  @ApiCreatedResponse()
  login(@Body() input: LocalLoginDto, @Req() request: Request) {
    return this.auth.login(input.email, input.password, input.tenantSlug, { ...this.metadata(request), currentRefreshToken: input.currentRefreshToken, revokeFamilyId: input.revokeFamilyId });
  }

  @Post("invitations/activate")
  @ApiOperation({ summary: "Set a password and activate a first-owner invitation" })
  @ApiCreatedResponse()
  activate(@Body() input: ActivateInvitationDto, @Req() request: Request) {
    return this.auth.activateInvitation(input.invitationToken, input.password, this.metadata(request));
  }

  @Post("refresh")
  @ApiOperation({ summary: "Rotate a refresh session and issue a new access token" })
  @ApiCreatedResponse()
  refresh(@Body() input: RefreshSessionDto, @Req() request: Request) {
    return this.auth.refresh(input.refreshToken, this.metadata(request));
  }

  @Post("logout")
  @ApiOperation({ summary: "Revoke the current refresh session" })
  @ApiCreatedResponse()
  logout(@Body() input: LogoutDto) {
    return this.auth.logout(input.refreshToken);
  }

  @Post("password/forgot")
  @ApiOperation({ summary: "Issue password recovery without exposing account existence" })
  @ApiCreatedResponse()
  forgotPassword(@Body() input: ForgotPasswordDto) {
    return this.auth.forgotPassword(input.email, input.tenantSlug);
  }

  @Post("password/reset")
  @ApiOperation({ summary: "Reset a local password and revoke existing sessions" })
  @ApiCreatedResponse()
  resetPassword(@Body() input: ResetPasswordDto) {
    return this.auth.resetPassword(input.resetToken, input.password);
  }

  @Post("mfa/verify")
  @ApiOperation({ summary: "Complete a password sign-in with TOTP or a recovery code" })
  @ApiCreatedResponse()
  verifyMfa(@Body() input: VerifyMfaChallengeDto, @Req() request: Request) {
    return this.auth.verifyMfaLogin(input.challengeToken, input.code, {
      ...this.metadata(request),
      currentRefreshToken: input.currentRefreshToken,
      revokeFamilyId: input.revokeFamilyId,
    });
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
