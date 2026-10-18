import { Module } from "@nestjs/common";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { CrmSettingsController } from "./crm-settings.controller";
import { CrmSettingsService } from "./crm-settings.service";
import { EnquiryFieldsService } from "./enquiry-fields.service";
@Module({ imports: [WorkspacesModule], controllers: [CrmSettingsController], providers: [CrmSettingsService, EnquiryFieldsService] }) export class CrmSettingsModule {}
