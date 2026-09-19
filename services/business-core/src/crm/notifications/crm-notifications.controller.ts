import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { InternalServiceGuard } from "../../auth/internal-service.guard";
import { Public } from "../../auth/public.decorator";
import { CrmNotificationsService } from "./crm-notifications.service";
import { ApproveTemplateDto, ClaimNotificationJobsDto, ClaimPushReceiptsDto, CreateNotificationPolicyDto, CreateNotificationTemplateDto, EnqueueNotificationDto, NotificationPolicyStatusDto, NotificationResultDto, PushPreferenceDto, PushReceiptResultDto, RecordDeviceConsentDto, RegisterDeviceEndpointDto, RevokeDeviceEndpointDto, UpsertPreferenceDto } from "./dto/notifications.dto";
@ApiTags("crm-notifications") @ApiBearerAuth() @Controller("workspaces/:workspaceId/crm")
export class CrmNotificationsController {
  constructor(private readonly notifications: CrmNotificationsService) {}
  @Get("notification-templates") templates(@CurrentActor() actor: RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string){return this.notifications.templates(actor,workspaceId);}
  @Post("notification-templates") create(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() input:CreateNotificationTemplateDto){return this.notifications.createTemplate(actor,workspaceId,input);}
  @Post("notification-templates/:id/approve") approve(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("id",ParseUUIDPipe) id:string,@Body() input:ApproveTemplateDto){return this.notifications.approveTemplate(actor,workspaceId,id,input);}
  @Post("notification-policies") policy(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() input:CreateNotificationPolicyDto){return this.notifications.createPolicy(actor,workspaceId,input);}
  @Get("notification-policies") policies(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string){return this.notifications.policies(actor,workspaceId);}
  @Patch("notification-policies/:id/status") policyStatus(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("id",ParseUUIDPipe) id:string,@Body() input:NotificationPolicyStatusDto){return this.notifications.setPolicyStatus(actor,workspaceId,id,input);}
  @Post("notification-preferences") preference(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() input:UpsertPreferenceDto){return this.notifications.preference(actor,workspaceId,input);}
  @Get("notification-settings") settings(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string){return this.notifications.notificationSettings(actor,workspaceId);}
  @Put("notification-settings/consent") consent(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() input:RecordDeviceConsentDto){return this.notifications.recordDeviceConsent(actor,workspaceId,input);}
  @Put("notification-settings/push") pushPreference(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() input:PushPreferenceDto){return this.notifications.setPushPreference(actor,workspaceId,input);}
  @Post("device-endpoints") registerDevice(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Body() input:RegisterDeviceEndpointDto){return this.notifications.registerDevice(actor,workspaceId,input);}
  @Post("device-endpoints/:id/revoke") revokeDevice(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("id",ParseUUIDPipe) id:string,@Body() input:RevokeDeviceEndpointDto){return this.notifications.revokeDevice(actor,workspaceId,id,input);}
  @Get("notifications") inbox(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string){return this.notifications.inbox(actor,workspaceId);}
  @Post("notifications/:id/read") read(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("id",ParseUUIDPipe) id:string){return this.notifications.read(actor,workspaceId,id);}
  @Post("notifications/:id/open") open(@CurrentActor() actor:RequestActor,@Param("workspaceId",ParseUUIDPipe) workspaceId:string,@Param("id",ParseUUIDPipe) id:string){return this.notifications.open(actor,workspaceId,id);}
}
@ApiExcludeController() @Public() @UseGuards(InternalServiceGuard) @Controller("internal/crm/notifications")
export class InternalCrmNotificationsController {
  constructor(private readonly notifications:CrmNotificationsService){}
  @Post("enqueue") enqueue(@Body() input:EnqueueNotificationDto){return this.notifications.enqueueInternal(input);}
  @Post("claim") claim(@Body() input:ClaimNotificationJobsDto){return this.notifications.claimInternal(input);}
  @Post(":id/result") result(@Param("id",ParseUUIDPipe) id:string,@Body() input:NotificationResultDto){return this.notifications.resultInternal(id,input);}
  @Post("push-receipts/claim") claimPushReceipts(@Body() input:ClaimPushReceiptsDto){return this.notifications.claimPushReceipts(input);}
  @Post(":id/push-receipt") pushReceipt(@Param("id",ParseUUIDPipe) id:string,@Body() input:PushReceiptResultDto){return this.notifications.pushReceiptResult(id,input);}
}
