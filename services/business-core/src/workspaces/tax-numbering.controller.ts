import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { SaveNumberingDto, SaveTaxSettingsDto } from "./dto/tax-numbering.dto";
import { TaxNumberingService } from "./tax-numbering.service";

@ApiTags("tax and numbering")
@ApiBearerAuth()
@Controller("workspaces")
export class TaxNumberingController {
  constructor(private readonly taxNumbering: TaxNumberingService) {}

  @Get(":workspaceId/legal-entities/:entityId/tax-numbering")
  @ApiOperation({ summary: "Tax model, rates and document numbering for a legal entity" })
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("entityId", ParseUUIDPipe) entityId: string) {
    return this.taxNumbering.get(actor, workspaceId, entityId);
  }

  @Put(":workspaceId/legal-entities/:entityId/tax")
  @ApiOperation({ summary: "Set the entity's tax rates (effective from now)" })
  saveTax(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("entityId", ParseUUIDPipe) entityId: string, @Body() input: SaveTaxSettingsDto) {
    return this.taxNumbering.saveTax(actor, workspaceId, entityId, input);
  }

  @Patch(":workspaceId/legal-entities/:entityId/numbering/:documentType")
  @ApiOperation({ summary: "Set how a document type is numbered for the entity" })
  saveNumbering(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("entityId", ParseUUIDPipe) entityId: string, @Param("documentType") documentType: string, @Body() input: SaveNumberingDto) {
    return this.taxNumbering.saveNumbering(actor, workspaceId, entityId, documentType, input);
  }
}
