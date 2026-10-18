import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../../auth/actor";
import { CurrentActor } from "../../auth/current-actor.decorator";
import { AllowWhenReadOnly } from "../../auth/tenant-write-block.guard";
import { CrmPartiesService } from "./crm-parties.service";
import {
  AddressInputDto,
  ArchivePartyDto,
  ContactPointInputDto,
  CreatePartyDto,
  CreateRelationshipDto,
  ExportPartiesDto,
  ListPartiesQueryDto,
  MergePartiesDto,
  PartyResponseDto,
  PrivacyErasePartyDto,
  ReverseMergeDto,
  UpdateAddressDto,
  UpdateContactPointDto,
  UpdatePartyDto,
  UpdateRelationshipDto,
  UpsertConsentDto,
} from "./dto/parties.dto";

@ApiTags("crm-parties")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/crm")
export class CrmPartiesController {
  constructor(private readonly parties: CrmPartiesService) {}

  @Get("parties")
  @ApiOperation({ summary: "Search CRM people, organizations, and households" })
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Query() query: ListPartiesQueryDto) {
    return this.parties.list(actor, workspaceId, query);
  }

  @Post("parties")
  @ApiCreatedResponse({ type: PartyResponseDto })
  create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreatePartyDto) {
    return this.parties.create(actor, workspaceId, input);
  }

  @Post("parties/export")
  @AllowWhenReadOnly()
  exportParties(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: ExportPartiesDto) {
    return this.parties.export(actor, workspaceId, input);
  }

  @Get("parties/:partyId")
  @ApiOkResponse({ type: PartyResponseDto })
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string) {
    return this.parties.get(actor, workspaceId, partyId);
  }

  @Patch("parties/:partyId")
  update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string, @Body() input: UpdatePartyDto) {
    return this.parties.update(actor, workspaceId, partyId, input);
  }

  @Post("parties/:partyId/contact-points")
  addContact(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string, @Body() input: ContactPointInputDto) {
    return this.parties.addContact(actor, workspaceId, partyId, input);
  }

  @Patch("parties/:partyId/contact-points/:contactId")
  updateContact(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string, @Param("contactId", ParseUUIDPipe) contactId: string, @Body() input: UpdateContactPointDto) {
    return this.parties.updateContact(actor, workspaceId, partyId, contactId, input);
  }

  @Post("parties/:partyId/addresses")
  addAddress(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string, @Body() input: AddressInputDto) {
    return this.parties.addAddress(actor, workspaceId, partyId, input);
  }

  @Patch("parties/:partyId/addresses/:addressId")
  updateAddress(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string, @Param("addressId", ParseUUIDPipe) addressId: string, @Body() input: UpdateAddressDto) {
    return this.parties.updateAddress(actor, workspaceId, partyId, addressId, input);
  }

  @Post("parties/:partyId/archive")
  archive(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string, @Body() input: ArchivePartyDto) {
    return this.parties.archive(actor, workspaceId, partyId, input);
  }

  @Post("parties/:partyId/privacy-erasure")
  erase(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string, @Body() input: PrivacyErasePartyDto) {
    return this.parties.privacyErase(actor, workspaceId, partyId, input);
  }

  @Post("parties/:partyId/consents")
  upsertConsent(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("partyId", ParseUUIDPipe) partyId: string, @Body() input: UpsertConsentDto) {
    return this.parties.upsertConsent(actor, workspaceId, partyId, input);
  }

  @Post("relationships")
  addRelationship(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: CreateRelationshipDto) {
    return this.parties.addRelationship(actor, workspaceId, input);
  }

  @Patch("relationships/:relationshipId")
  updateRelationship(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("relationshipId", ParseUUIDPipe) relationshipId: string, @Body() input: UpdateRelationshipDto) {
    return this.parties.updateRelationship(actor, workspaceId, relationshipId, input);
  }

  @Post("parties/merge")
  merge(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Body() input: MergePartiesDto) {
    return this.parties.merge(actor, workspaceId, input);
  }

  @Post("party-merges/:operationId/reverse")
  reverseMerge(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string, @Param("operationId", ParseUUIDPipe) operationId: string, @Body() input: ReverseMergeDto) {
    return this.parties.reverseMerge(actor, workspaceId, operationId, input);
  }
}
