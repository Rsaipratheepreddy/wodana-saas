import {
  Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, StreamableFile, UseGuards,
} from "@nestjs/common";
import { ApiHeader, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { PlatformOperatorGuard, type OperatorRequest } from "../../auth/platform-operator.guard";
import { PlatformOperatorPermissionGuard, RequireOperatorPermission } from "../../auth/platform-operator-permission.guard";
import { Public } from "../../auth/public.decorator";
import { SalesContactFormService } from "./sales-contact-form.service";
import {
  AddSalesEnquiryNoteDto,
  AssignSalesEnquiryDto,
  ChangeSalesEnquiryStatusDto,
  ListSalesEnquiriesQueryDto,
  SaveSalesContactFormDto,
  SubmitSalesEnquiryDto,
} from "./sales-enquiries.dto";
import { SalesEnquiriesService } from "./sales-enquiries.service";

const operatorId = (request: OperatorRequest) => request.platformOperator!.userId;

/** Wodana's public "Contact sales" form: the current form and one submission at a time. */
@ApiTags("public sales")
@Public()
@Controller("public/sales")
export class PublicSalesController {
  constructor(private readonly forms: SalesContactFormService, private readonly enquiries: SalesEnquiriesService) {}

  @Get("contact-form")
  form() {
    return this.forms.publicForm();
  }

  /**
   * The web server passes the visitor's address in `x-sales-requester` for the per-connection limit; it is
   * trusted only together with the internal service token, otherwise the connection's own address counts.
   */
  @Post("enquiries")
  submit(@Body() input: SubmitSalesEnquiryDto, @Headers("x-sales-requester") requester: string | undefined,
    @Headers("x-wodana-internal-token") internalToken: string | undefined, @Req() request: Request) {
    return this.enquiries.submit(input, this.enquiries.requesterAddress({ requester, internalToken, remote: request.ip }));
  }
}

/** Sales enquiries in Wodana Control: list, record, status, assignee, notes and CSV export. */
@ApiTags("operator console")
@Public()
@UseGuards(InternalServiceGuard, PlatformOperatorGuard, PlatformOperatorPermissionGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@ApiHeader({ name: "x-wodana-operator-session", required: true })
@Controller("internal/operator/sales-enquiries")
export class OperatorSalesEnquiriesController {
  constructor(private readonly enquiries: SalesEnquiriesService) {}

  @Get()
  @RequireOperatorPermission("sales.read")
  list(@Query() query: ListSalesEnquiriesQueryDto, @Req() request: OperatorRequest) {
    return this.enquiries.list(operatorId(request), query);
  }

  @Get("export")
  @RequireOperatorPermission("sales.read")
  async export(@Query() query: ListSalesEnquiriesQueryDto, @Req() request: OperatorRequest) {
    const { csv, fileName } = await this.enquiries.exportCsv(operatorId(request), query);
    return new StreamableFile(Buffer.from(`﻿${csv}`, "utf8"), {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @Get("assignees")
  @RequireOperatorPermission("sales.read")
  assignees(@Req() request: OperatorRequest) {
    return this.enquiries.assignees(operatorId(request));
  }

  @Get(":id")
  @RequireOperatorPermission("sales.read")
  detail(@Param("id", ParseUUIDPipe) id: string, @Req() request: OperatorRequest) {
    return this.enquiries.detail(operatorId(request), id);
  }

  @Post(":id/status")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("sales.manage")
  changeStatus(@Param("id", ParseUUIDPipe) id: string, @Body() input: ChangeSalesEnquiryStatusDto, @Req() request: OperatorRequest) {
    return this.enquiries.changeStatus(operatorId(request), id, input);
  }

  @Post(":id/assignee")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("sales.manage")
  assign(@Param("id", ParseUUIDPipe) id: string, @Body() input: AssignSalesEnquiryDto, @Req() request: OperatorRequest) {
    return this.enquiries.assign(operatorId(request), id, input);
  }

  @Post(":id/notes")
  @HttpCode(HttpStatus.OK)
  @RequireOperatorPermission("sales.manage")
  addNote(@Param("id", ParseUUIDPipe) id: string, @Body() input: AddSalesEnquiryNoteDto, @Req() request: OperatorRequest) {
    return this.enquiries.addNote(operatorId(request), id, input);
  }
}

/** The "Contact sales" form settings: fields, team sizes, thank-you text and recipients (versioned). */
@ApiTags("operator console")
@Public()
@UseGuards(InternalServiceGuard, PlatformOperatorGuard, PlatformOperatorPermissionGuard)
@ApiHeader({ name: "x-wodana-internal-token", required: true })
@ApiHeader({ name: "x-wodana-operator-session", required: true })
@Controller("internal/operator/sales-contact-form")
export class OperatorSalesContactFormController {
  constructor(private readonly forms: SalesContactFormService) {}

  @Get()
  @RequireOperatorPermission("sales.read")
  settings(@Req() request: OperatorRequest) {
    return this.forms.settings(operatorId(request));
  }

  @Put()
  @RequireOperatorPermission("sales.manage")
  save(@Body() input: SaveSalesContactFormDto, @Headers("idempotency-key") idempotencyKey: string | undefined, @Req() request: OperatorRequest) {
    return this.forms.save(operatorId(request), input, idempotencyKey);
  }
}
