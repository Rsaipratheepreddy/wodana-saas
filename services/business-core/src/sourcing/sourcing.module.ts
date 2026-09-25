import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { RequestActor } from "../auth/actor";
import { CurrentActor } from "../auth/current-actor.decorator";
import { WorkspacesModule } from "../workspaces/workspaces.module";
import { VendorDirectoryService } from "./vendor-directory.service";
import { SupplierOfferService } from "./supplier-offer.service";
import {
  ApplicableSupplierOffersQueryDto,
  CreateSupplierOfferDto,
  ListSupplierOffersQueryDto,
  SupplierOfferLifecycleDto,
  UpdateSupplierOfferDto,
} from "./supplier-offer.dto";
import {
  CreateVendorDto,
  ImportVendorsDto,
  CreateVendorSiteDto,
  ListVendorsQueryDto,
  UpdateVendorDto,
  UpdateVendorSiteDto,
  VendorLifecycleDto,
  VendorSiteLifecycleDto,
} from "./vendor.dto";

@ApiTags("workspace-vendors")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/vendors")
export class VendorDirectoryController {
  constructor(private readonly vendors: VendorDirectoryService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query() query: ListVendorsQueryDto) {
    return this.vendors.list(actor, workspaceId, query);
  }

  @Post("import")
  import(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: ImportVendorsDto) {
    return this.vendors.import(actor, workspaceId, input);
  }

  @Post()
  create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: CreateVendorDto) {
    return this.vendors.create(actor, workspaceId, input);
  }

  @Get(":vendorId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("vendorId", ParseUUIDPipe) vendorId: string) {
    return this.vendors.get(actor, workspaceId, vendorId);
  }

  @Patch(":vendorId")
  update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("vendorId", ParseUUIDPipe) vendorId: string, @Body() input: UpdateVendorDto) {
    return this.vendors.update(actor, workspaceId, vendorId, input);
  }

  @Post(":vendorId/lifecycle")
  lifecycle(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("vendorId", ParseUUIDPipe) vendorId: string, @Body() input: VendorLifecycleDto) {
    return this.vendors.lifecycle(actor, workspaceId, vendorId, input);
  }

  @Post(":vendorId/sites")
  createSite(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("vendorId", ParseUUIDPipe) vendorId: string, @Body() input: CreateVendorSiteDto) {
    return this.vendors.createSite(actor, workspaceId, vendorId, input);
  }

  @Patch(":vendorId/sites/:siteId")
  updateSite(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("vendorId", ParseUUIDPipe) vendorId: string, @Param("siteId", ParseUUIDPipe) siteId: string,
    @Body() input: UpdateVendorSiteDto) {
    return this.vendors.updateSite(actor, workspaceId, vendorId, siteId, input);
  }

  @Post(":vendorId/sites/:siteId/lifecycle")
  siteLifecycle(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("vendorId", ParseUUIDPipe) vendorId: string, @Param("siteId", ParseUUIDPipe) siteId: string,
    @Body() input: VendorSiteLifecycleDto) {
    return this.vendors.siteLifecycle(actor, workspaceId, vendorId, siteId, input);
  }
}

@ApiTags("supplier-offers")
@ApiBearerAuth()
@Controller("workspaces/:workspaceId/supplier-offers")
export class SupplierOfferController {
  constructor(private readonly offers: SupplierOfferService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query() query: ListSupplierOffersQueryDto) {
    return this.offers.list(actor, workspaceId, query);
  }

  @Get("options")
  applicable(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Query() query: ApplicableSupplierOffersQueryDto) {
    return this.offers.applicable(actor, workspaceId, query);
  }

  @Post()
  create(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Body() input: CreateSupplierOfferDto) {
    return this.offers.create(actor, workspaceId, input);
  }

  @Get(":offerId")
  get(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("offerId", ParseUUIDPipe) offerId: string) {
    return this.offers.get(actor, workspaceId, offerId);
  }

  @Patch(":offerId")
  update(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("offerId", ParseUUIDPipe) offerId: string, @Body() input: UpdateSupplierOfferDto) {
    return this.offers.update(actor, workspaceId, offerId, input);
  }

  @Post(":offerId/lifecycle")
  lifecycle(@CurrentActor() actor: RequestActor, @Param("workspaceId", ParseUUIDPipe) workspaceId: string,
    @Param("offerId", ParseUUIDPipe) offerId: string, @Body() input: SupplierOfferLifecycleDto) {
    return this.offers.lifecycle(actor, workspaceId, offerId, input);
  }
}

@Module({ imports: [WorkspacesModule], controllers: [VendorDirectoryController, SupplierOfferController], providers: [VendorDirectoryService, SupplierOfferService], exports: [VendorDirectoryService, SupplierOfferService] })
export class SourcingModule {}
