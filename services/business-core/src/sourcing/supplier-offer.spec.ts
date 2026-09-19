import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it, vi } from "vitest";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import {
  SupplierOfferService,
  validateSupplierOfferShape,
} from "./supplier-offer.service";
import { ApplicableSupplierOffersQueryDto, CreateSupplierOfferDto } from "./supplier-offer.dto";

const complete = {
  vendorSiteId: null, legalEntityId: "entity", unitRecordId: "unit", supplierSku: null, amount: 25, currency: "AED",
  quantityFrom: null, minimumOrderQuantity: 10, orderMultiple: 5, leadTimeDays: 2,
  effectiveFrom: "2026-09-15", effectiveTo: null, sourceType: "vendor_quote",
  sourceReference: "Q-1", taxTreatment: "exclusive", inclusions: [], terms: "", notes: "",
};

describe("supplier offer contract", () => {
  it("allows an incomplete draft but requires an attributable commercial basis for activation", () => {
    expect(() => validateSupplierOfferShape({ ...complete, amount: null, sourceReference: null }, false)).not.toThrow();
    expect(() => validateSupplierOfferShape({ ...complete, amount: null, sourceReference: null }, true)).toThrow(BadRequestException);
    expect(() => validateSupplierOfferShape({ ...complete, sourceReference: "   " }, true)).toThrow(BadRequestException);
    expect(() => validateSupplierOfferShape({ ...complete, legalEntityId: null }, true)).toThrow(/legal entity/);
  });

  it("distinguishes missing, zero and explicitly included costs", () => {
    expect(() => validateSupplierOfferShape({ ...complete, amount: 0 }, false)).toThrow(/included/);
    expect(() => validateSupplierOfferShape({ ...complete, amount: 0, sourceType: "included" }, true)).not.toThrow();
    expect(() => validateSupplierOfferShape({ ...complete, amount: 1, sourceType: "included" }, false)).toThrow(/zero/);
  });

  it("rejects reversed validity periods", () => {
    expect(() => validateSupplierOfferShape({ ...complete, effectiveFrom: "2026-10-01", effectiveTo: "2026-09-30" }, false)).toThrow(/end date/);
  });

  it("validates bounded pricing, tiers, MOQ, multiples and inclusions", async () => {
    const value = plainToInstance(CreateSupplierOfferDto, {
      id: "60a3d647-3042-45cf-bef4-43a1c35bec49", version: 0,
      vendorId: "f7aa8f03-c59b-4f7b-b432-633d10c99e04",
      catalogRecordId: "83684c52-f0b8-4fb8-9682-a38dd55870de",
      amount: -1, currency: "dirham", quantityFrom: 0, minimumOrderQuantity: 0,
      orderMultiple: 0, leadTimeDays: 4000, inclusions: ["delivery", "delivery", "finance"],
    });
    expect((await validate(value)).length).toBeGreaterThanOrEqual(7);
  });

  it("normalizes an applicable-offer query without permitting a zero quantity", async () => {
    const value = plainToInstance(ApplicableSupplierOffersQueryDto, {
      catalogRecordId: "83684c52-f0b8-4fb8-9682-a38dd55870de",
      unitRecordId: "b52df644-1f0b-43c4-ac95-cc6faec45a78",
      legalEntityId: "f7aa8f03-c59b-4f7b-b432-633d10c99e04",
      currency: " aed ", quantity: 0,
    });
    expect(value.currency).toBe("AED");
    expect((await validate(value)).length).toBe(1);
  });

  it("returns only current active offers for the exact entity, currency, unit and quantity tier", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const withPermission = vi.fn(
      async (
        _actor: unknown,
        _workspaceId: string,
        _permission: string,
        work: (client: { query: typeof query }) => unknown,
      ) => work({ query }),
    );
    const service = new SupplierOfferService(
      { withPermission } as unknown as WorkspaceAccessService,
      {} as CrmEventsService,
    );
    const input = {
      catalogRecordId: "83684c52-f0b8-4fb8-9682-a38dd55870de",
      unitRecordId: "b52df644-1f0b-43c4-ac95-cc6faec45a78",
      legalEntityId: "f7aa8f03-c59b-4f7b-b432-633d10c99e04",
      currency: "AED",
      quantity: 12,
      validOn: "2026-09-18",
    };

    await expect(service.applicable({} as never, "workspace", input)).resolves.toEqual({
      ...input,
      options: [],
    });
    expect(withPermission).toHaveBeenCalledWith(
      {},
      "workspace",
      "supplier_offers.view",
      expect.any(Function),
    );
    const [sql, parameters] = query.mock.calls[0];
    expect(sql).toContain("offer.status='active'");
    expect(sql).toContain("vendor.status='active'");
    expect(sql).toContain("site.status='active'");
    expect(sql).toContain("NOT record.archived");
    expect(sql).toContain("NOT unit.archived");
    expect(sql).toContain("offer.effective_from<=$6::date");
    expect(sql).toContain("coalesce(offer.quantity_from,0)<=$7");
    expect(parameters).toEqual([
      "workspace",
      input.catalogRecordId,
      input.unitRecordId,
      input.legalEntityId,
      input.currency,
      input.validOn,
      input.quantity,
    ]);
  });
});
