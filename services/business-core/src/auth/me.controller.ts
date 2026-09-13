import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "./actor";
import { CurrentActor } from "./current-actor.decorator";
import { IdentityService } from "./identity.service";
import { MeResponseDto } from "./me-response.dto";

@ApiTags("identity")
@ApiBearerAuth()
@Controller("me")
export class MeController {
  constructor(private readonly identities: IdentityService) {}

  @Get()
  @ApiOperation({ summary: "Load the signed-in user and workspace memberships" })
  @ApiOkResponse({ type: MeResponseDto })
  getProfile(@CurrentActor() actor: RequestActor) {
    return this.identities.getProfile(actor);
  }
}
