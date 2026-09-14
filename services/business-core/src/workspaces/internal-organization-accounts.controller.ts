import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { InternalServiceGuard } from "../auth/internal-service.guard";
import { Public } from "../auth/public.decorator";
import { CustomerAccountsService } from "./customer-accounts.service";
import {
  ApproveOrganizationRequestDto,
  ListOrganizationRequestsQueryDto,
  RejectOrganizationRequestDto,
  UpdateCustomerAccountLimitDto,
} from "./dto/organization-request.dto";

@ApiTags("internal customer accounts")
@Public()
@UseGuards(InternalServiceGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@Controller("internal")
export class InternalOrganizationAccountsController {
  constructor(private readonly accounts: CustomerAccountsService) {}

  @Get("organization-requests")
  @ApiOperation({ summary: "List additional-organization requests for Wodana review" })
  @ApiOkResponse()
  listRequests(@Query() query: ListOrganizationRequestsQueryDto) {
    return this.accounts.listRequestsForReview(query.status);
  }

  @Get("customer-accounts/:accountId")
  @ApiOperation({ summary: "Read a customer account, its organizations, limits and requests" })
  @ApiOkResponse()
  getAccount(@Param("accountId", ParseUUIDPipe) accountId: string) {
    return this.accounts.getAccountForManagement(accountId);
  }

  @Post("organization-requests/:requestId/approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Approve and provision an additional organization" })
  @ApiOkResponse()
  approveRequest(
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() input: ApproveOrganizationRequestDto,
  ) {
    return this.accounts.approveRequest(requestId, input);
  }

  @Post("organization-requests/:requestId/reject")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Reject an additional-organization request" })
  @ApiOkResponse()
  rejectRequest(
    @Param("requestId", ParseUUIDPipe) requestId: string,
    @Body() input: RejectOrganizationRequestDto,
  ) {
    return this.accounts.rejectRequest(requestId, input);
  }

  @Patch("customer-accounts/:accountId/organization-limit")
  @ApiOperation({ summary: "Change the approved organization limit for a customer account" })
  @ApiOkResponse()
  updateOrganizationLimit(
    @Param("accountId", ParseUUIDPipe) accountId: string,
    @Body() input: UpdateCustomerAccountLimitDto,
  ) {
    return this.accounts.updateOrganizationLimit(accountId, input);
  }
}
