import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { CustomerAccountsService } from "./customer-accounts.service";
import {
  CreateOrganizationRequestDto,
  VersionedOrganizationRequestDto,
} from "./dto/organization-request.dto";

@ApiTags("customer accounts")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/account")
export class CustomerAccountsController {
  constructor(private readonly accounts: CustomerAccountsService) {}

  @Get()
  @ApiOperation({ summary: "Read the current customer account and accessible organizations" })
  @ApiOkResponse()
  getAccount(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.accounts.getAccount(actor, workspaceId);
  }

  @Get("organization-requests")
  @ApiOperation({ summary: "List additional-organization requests for this account" })
  @ApiOkResponse()
  listRequests(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
  ) {
    return this.accounts.listRequests(actor, workspaceId);
  }

  @Post("organization-requests")
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    description: "Stable key for one additional-organization request",
  })
  @ApiOperation({ summary: "Request an additional independent organization" })
  @ApiCreatedResponse()
  requestOrganization(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: CreateOrganizationRequestDto,
  ) {
    return this.accounts.requestOrganization(actor, workspaceId, input, idempotencyKey);
  }

  @Post("organization-requests/:requestId/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Cancel a pending additional-organization request" })
  @ApiOkResponse()
  cancelRequest(
    @CurrentActor() actor: RequestActor,
    @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() input: VersionedOrganizationRequestDto,
  ) {
    return this.accounts.cancelRequest(actor, workspaceId, requestId, input.expectedVersion);
  }
}
