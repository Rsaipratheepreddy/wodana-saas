import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "./actor";
import { CurrentActor } from "./current-actor.decorator";
import { SessionSecurityDto } from "./dto/local-auth.dto";
import { LocalAuthService } from "./local-auth.service";

@ApiTags("security")
@Controller("security")
export class SecurityController {
  constructor(private readonly auth: LocalAuthService) {}

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
