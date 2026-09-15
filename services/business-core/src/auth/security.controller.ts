import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "./actor";
import { CurrentActor } from "./current-actor.decorator";
import {
  MfaFactorDto,
  MfaSessionDto,
  MfaWorkspaceQueryDto,
  SessionSecurityDto,
} from "./dto/local-auth.dto";
import { LocalAuthService } from "./local-auth.service";
import {
  AllowDuringMfaEnrollment,
  RequireRecentMfa,
} from "./mfa-step-up.decorator";

@ApiTags("security")
@Controller("security")
export class SecurityController {
  constructor(private readonly auth: LocalAuthService) {}

  @Get("mfa/status")
  @AllowDuringMfaEnrollment()
  @ApiOperation({ summary: "Read MFA enrollment, recovery and account-policy status" })
  @ApiOkResponse()
  mfaStatus(@CurrentActor() actor: RequestActor, @Query() query: MfaWorkspaceQueryDto) {
    return this.auth.mfaStatus(actor, query.workspaceId);
  }

  @Post("mfa/totp/setup")
  @HttpCode(HttpStatus.OK)
  @AllowDuringMfaEnrollment()
  @ApiOperation({ summary: "Start a time-limited TOTP enrollment" })
  @ApiOkResponse()
  setupTotp(@CurrentActor() actor: RequestActor, @Body() input: MfaSessionDto) {
    return this.auth.startTotpEnrollment(actor, input.refreshToken, input.workspaceId);
  }

  @Post("mfa/totp/confirm")
  @HttpCode(HttpStatus.OK)
  @AllowDuringMfaEnrollment()
  @ApiOperation({ summary: "Confirm TOTP enrollment and issue one-time recovery codes" })
  @ApiOkResponse()
  confirmTotp(@CurrentActor() actor: RequestActor, @Body() input: MfaFactorDto) {
    return this.auth.confirmTotpEnrollment(
      actor,
      input.refreshToken,
      input.workspaceId,
      input.code,
    );
  }

  @Post("mfa/step-up")
  @HttpCode(HttpStatus.OK)
  @AllowDuringMfaEnrollment()
  @ApiOperation({ summary: "Issue a recently MFA-verified access token for sensitive actions" })
  @ApiOkResponse()
  stepUp(@CurrentActor() actor: RequestActor, @Body() input: MfaFactorDto) {
    return this.auth.stepUpMfa(actor, input.refreshToken, input.workspaceId, input.code);
  }

  @Post("mfa/recovery-codes/regenerate")
  @HttpCode(HttpStatus.OK)
  @RequireRecentMfa("mfa.recovery_codes.rotate")
  @ApiOperation({ summary: "Replace all unused recovery codes" })
  @ApiOkResponse()
  rotateRecoveryCodes(@CurrentActor() actor: RequestActor, @Body() input: MfaSessionDto) {
    return this.auth.rotateRecoveryCodes(actor, input.refreshToken, input.workspaceId);
  }

  @Post("mfa/disable")
  @HttpCode(HttpStatus.OK)
  @RequireRecentMfa("mfa.disable")
  @ApiOperation({ summary: "Disable optional MFA and revoke other sessions" })
  @ApiOkResponse()
  disableMfa(@CurrentActor() actor: RequestActor, @Body() input: MfaSessionDto) {
    return this.auth.disableMfa(actor, input.refreshToken, input.workspaceId);
  }

  @Post("sessions/query")
  @ApiOperation({ summary: "List the signed-in user's active session families" })
  @ApiOkResponse()
  sessions(@CurrentActor() actor: RequestActor, @Body() input: SessionSecurityDto) {
    return this.auth.securityOverview(actor, input.refreshToken, input.workspaceId);
  }

  @Post("sessions/:familyId/revoke")
  @ApiOperation({ summary: "Revoke another active session family" })
  @ApiOkResponse()
  revokeSession(
    @CurrentActor() actor: RequestActor,
    @Param("familyId", ParseUUIDPipe) familyId: string,
    @Body() input: SessionSecurityDto,
  ) {
    return this.auth.revokeSession(actor, familyId, input.refreshToken, input.workspaceId);
  }

  @Post("sessions/revoke-others")
  @ApiOperation({ summary: "Revoke every session family except the current one" })
  @ApiOkResponse()
  revokeOtherSessions(@CurrentActor() actor: RequestActor, @Body() input: SessionSecurityDto) {
    return this.auth.revokeOtherSessions(actor, input.refreshToken, input.workspaceId);
  }
}
