import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { describe, expect, it } from "vitest";
import { validateSupplierOfferShape } from "./supplier-offer.service";
import { ApplicableSupplierOffersQueryDto, CreateSupplierOfferDto } from "./supplier-offer.dto";

const complete = {
  vendorSiteId: null, unitRecordId: "unit", supplierSku: null, amount: 25, currency: "AED",
  quantityFrom: null, minimumOrderQuantity: 10, orderMultiple: 5, leadTimeDays: 2,
  effectiveFrom: "2026-09-15", effectiveTo: null, sourceType: "vendor_quote",
  sourceReference: "Q-1", taxTreatment: "exclusive", inclusions: [], terms: "", notes: "",
};

describe("supplier offer contract", () => {
  it("allows an incomplete draft but requires an attributable commercial basis for activation", () => {
    expect(() => validateSupplierOfferShape({ ...complete, amount: null, sourceReference: null }, false)).not.toThrow();
    expect(() => validateSupplierOfferShape({ ...complete, amount: null, sourceReference: null }, true)).toThrow(BadRequestException);
    expect(() => validateSupplierOfferShape({ ...complete, sourceReference: "   " }, true)).toThrow(BadRequestException);
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
      currency: " aed ", quantity: 0,
    });
    expect(value.currency).toBe("AED");
    expect((await validate(value)).length).toBe(1);
  });
});
