import { BadRequestException, Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiExcludeController, ApiHeader, ApiTags } from "@nestjs/swagger";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { PlatformOperatorGuard, type OperatorRequest } from "../../auth/platform-operator.guard";
import { PlatformOperatorPermissionGuard, RequireOperatorPermission } from "../../auth/platform-operator-permission.guard";
import { Public } from "../../auth/public.decorator";
import { isPlatformCredentialProvider } from "./platform-credentials.domain";
import { SavePlatformCredentialsDto } from "./platform-credentials.dto";
import { PlatformCredentialsService } from "./platform-credentials.service";

function providerKey(value: string) {
  if (!isPlatformCredentialProvider(value)) throw new BadRequestException("Choose a valid provider.");
  return value;
}

/** Wodana Control → Platform connections (the platform administrator). */
@ApiTags("operator console")
@Public()
@UseGuards(InternalServiceGuard, PlatformOperatorGuard, PlatformOperatorPermissionGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@ApiHeader({ name: "x-wodana-operator-session", required: true })
@Controller("internal/operator/platform-integrations")
export class OperatorPlatformIntegrationsController {
  constructor(private readonly credentials: PlatformCredentialsService) {}

  @Get()
  @RequireOperatorPermission("platform.integrations.manage")
  list(@Req() request: OperatorRequest) {
    return this.credentials.list(request.platformOperator!.userId);
  }

  @Put(":provider")
  @RequireOperatorPermission("platform.integrations.manage")
  save(@Param("provider") provider: string, @Body() input: SavePlatformCredentialsDto,
    @Headers("idempotency-key") requestKey: string | undefined, @Req() request: OperatorRequest) {
    return this.credentials.save(providerKey(provider), input, requestKey, request.platformOperator!.userId);
  }

  @Post(":provider/test")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("platform.integrations.manage")
  test(@Param("provider") provider: string, @Req() request: OperatorRequest) {
    return this.credentials.test(providerKey(provider), request.platformOperator!.userId);
  }
}

/** The intelligence service's read of the platform credentials (secrets still sealed). */
@ApiTags("internal-integrations")
@ApiExcludeController()
@Public()
@UseGuards(InternalServiceGuard)
@Controller("internal/platform-integrations")
export class InternalPlatformIntegrationsController {
  constructor(private readonly credentials: PlatformCredentialsService) {}

  @Get("runtime")
  runtime() {
    return this.credentials.runtime();
  }
}
