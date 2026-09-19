import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Equals, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { Public } from "../../auth/public.decorator";
import { ListIntakeQueryDto } from "./dto/intake.dto";
import { LeadFormsService } from "./lead-forms.service";

class UpdateFormDto {
  @IsInt() @Min(1) version!: number;
  @IsOptional() @IsObject() draft?: Record<string, unknown>;
  @IsOptional() @IsIn(["save", "publish", "pause"]) action?: string;
}
class SubmitFormDto {
  @IsUUID() requestId!: string;
  @IsString() @MaxLength(100) revision!: string;
  @IsObject() answers!: Record<string, unknown>;
  @IsBoolean() @Equals(true, { message: "Consent is required before submitting an enquiry" })
  serviceConsent!: boolean;
}
@Controller("workspaces/:workspaceId/crm/lead-forms")
export class LeadFormsController {
  constructor(private readonly forms: LeadFormsService) {}
  @Get() list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.forms.list(actor, workspaceId); }
  @Get(":id/responses") responses(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Query() query: ListIntakeQueryDto) { return this.forms.responses(actor, workspaceId, id, query); }
  @Post() create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.forms.create(actor, workspaceId); }
  @Patch(":id") update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateFormDto) { return this.forms.update(actor, workspaceId, id, input); }
}
@Public()
@Controller("public/crm/lead-forms")
export class PublicLeadFormsController {
  constructor(private readonly forms: LeadFormsService) {}
  @Get(":token") get(@Param("token") token: string) { return this.forms.publicForm(token); }
  @Post(":token") submit(@Param("token") token: string, @Body() input: SubmitFormDto) { return this.forms.submit(token, input); }
}
