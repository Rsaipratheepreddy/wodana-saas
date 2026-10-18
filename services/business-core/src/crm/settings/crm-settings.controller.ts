import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { CrmSettingsService } from "./crm-settings.service";
import { EnquiryFieldsService } from "./enquiry-fields.service";
import { ArchiveSettingDto, CreateCustomFieldDto, EnquiryFieldValuesDto, EnquiryFieldVisibilityDto, EnquiryRequirementDto, CreateQualificationFormDto, CreateSavedViewDto, CreateTaxonomyDto, SetCustomFieldValueDto, UpdateCustomFieldDto, UpdateQualificationFormDto, UpdateSavedViewDto, UpdateTaxonomyDto } from "./dto/settings.dto";
import { RestoreConfigurationRevisionDto } from "../../workspaces/dto/restore-configuration-revision.dto";
@ApiTags("crm-settings") @ApiBearerAuth() @Controller("workspaces/:workspaceId/crm")
export class CrmSettingsController {
  constructor(private readonly settings: CrmSettingsService, private readonly enquiryFields: EnquiryFieldsService) {}
  @Get("enquiry-fields") fields(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.enquiryFields.list(actor, workspaceId); }
  @Put("leads/:leadId/fields") leadFields(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("leadId", ParseUUIDPipe) leadId: string, @Body() input: EnquiryFieldValuesDto) { return this.enquiryFields.setLeadValues(actor, workspaceId, leadId, input); }
  @Get("enquiry-requirements") requirements(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.enquiryFields.requirements(actor, workspaceId); }
  @Put("enquiry-requirements/:fieldKey") setRequirement(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("fieldKey") fieldKey: string, @Body() input: EnquiryRequirementDto) { return this.enquiryFields.setRequirement(actor, workspaceId, fieldKey, input); }
  @Put("enquiry-fields/system/:key") systemField(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("key") key: string, @Body() input: EnquiryFieldVisibilityDto) { return this.enquiryFields.setSystemVisibility(actor, workspaceId, key, input); }
  @Get("settings") list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string) { return this.settings.list(actor, workspaceId); }
  @Post("taxonomies") taxonomy(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateTaxonomyDto) { return this.settings.createTaxonomy(actor, workspaceId, input); }
  @Patch("taxonomies/:taxonomyId") updateTaxonomy(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("taxonomyId", ParseUUIDPipe) taxonomyId: string, @Body() input: UpdateTaxonomyDto) { return this.settings.updateTaxonomy(actor, workspaceId, taxonomyId, input); }
  @Post("custom-fields") field(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateCustomFieldDto) { return this.settings.createField(actor, workspaceId, input); }
  @Patch("custom-fields/:definitionId") updateField(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("definitionId", ParseUUIDPipe) definitionId: string, @Body() input: UpdateCustomFieldDto) { return this.settings.updateField(actor, workspaceId, definitionId, input); }
  @Post("custom-fields/:definitionId/value") value(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("definitionId", ParseUUIDPipe) definitionId: string, @Body() input: SetCustomFieldValueDto) { return this.settings.setFieldValue(actor, workspaceId, definitionId, input); }
  @Post("qualification-forms") form(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateQualificationFormDto) { return this.settings.createForm(actor, workspaceId, input); }
  @Patch("qualification-forms/:formId") updateForm(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("formId", ParseUUIDPipe) formId: string, @Body() input: UpdateQualificationFormDto) { return this.settings.updateForm(actor, workspaceId, formId, input); }
  @Post("saved-views") view(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateSavedViewDto) { return this.settings.createView(actor, workspaceId, input); }
  @Patch("saved-views/:viewId") updateView(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("viewId", ParseUUIDPipe) viewId: string, @Body() input: UpdateSavedViewDto) { return this.settings.updateView(actor, workspaceId, viewId, input); }
  @Post("settings/:type/:id/archive") archive(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("type") type: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: ArchiveSettingDto) { return this.settings.archive(actor, workspaceId, type, id, input); }
  @Get("settings/:type/:id/history") history(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("type") type: string, @Param("id", ParseUUIDPipe) id: string) { return this.settings.history(actor, workspaceId, type, id); }
  @Post("settings/:type/:id/rollback") rollback(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("type") type: string, @Param("id", ParseUUIDPipe) id: string, @Body() input: RestoreConfigurationRevisionDto) { return this.settings.rollback(actor, workspaceId, type, id, input); }
}
