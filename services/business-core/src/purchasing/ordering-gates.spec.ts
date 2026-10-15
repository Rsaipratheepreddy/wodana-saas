import { describe, expect, it } from "vitest";
import { GATE_KEYS, gateBlocks, gateCheck, type GateCheck, type GateSettings } from "./ordering-gates";
import { priceHoldReason } from "./price-hold";

const off: GateSettings = { requireDrawingsVerified: false, requireBoqApproved: false, requirePriceApproval: false, requireQsSignoff: false, requireMaterialListConfirmed: false };
const on: GateSettings = { requireDrawingsVerified: true, requireBoqApproved: true, requirePriceApproval: true, requireQsSignoff: true, requireMaterialListConfirmed: true };
const waiver = { reason: "Standard item, no drawing", byName: "Ava Approver", at: "2026-10-15T09:00:00.000Z" };

describe("ordering gate (PLM-159)", () => {
  it("with every setting off, no check is required, so nothing blocks", () => {
    const checks = GATE_KEYS.map((key) => gateCheck(key, off, { passed: false, missing: "x", waiver: null }));
    expect(checks.every((check) => !check.required)).toBe(true);
    expect(gateBlocks(checks)).toBeNull();
  });

  it("each setting makes its own check required, and the first failing one blocks", () => {
    const checks = GATE_KEYS.map((key) => gateCheck(key, on, { passed: key !== "boq_approved" && key !== "qs_signoff", missing: `${key} missing.`, waiver: null }));
    expect(checks.map((check) => check.required)).toEqual([true, true, true, true, true]);
    expect(gateBlocks(checks)?.key).toBe("boq_approved");
    expect(gateBlocks(checks)?.missing).toBe("boq_approved missing.");
  });

  it("a check marked not applicable on the order no longer blocks, and keeps who said so and why", () => {
    const checks: GateCheck[] = GATE_KEYS.map((key) => gateCheck(key, on, { passed: key === "price_approved", missing: `${key} missing.`, waiver: key === "qs_signoff" || key === "material_list_confirmed" ? null : waiver }));
    expect(gateBlocks(checks)?.key).toBe("qs_signoff");
    expect(checks.find((check) => check.key === "drawings_verified")?.waiver).toEqual(waiver);
  });

  it("project checks don't apply to an order with no project lines; the QS sign-off applies to every order", () => {
    const stock = GATE_KEYS.map((key) => gateCheck(key, on, { applies: key === "qs_signoff", passed: false, missing: "x", waiver: null }));
    expect(stock.filter((check) => check.required).map((check) => check.key)).toEqual(["qs_signoff"]);
  });

  it("a passed check carries no missing text", () => {
    expect(gateCheck("boq_approved", on, { passed: true, missing: "not approved", waiver: null })).toEqual({ key: "boq_approved", required: true, passed: true, missing: "", waiver: null });
  });
});

describe("price hold (PLM-169)", () => {
  const base = { title: "Kitchen cabinets", agreed: "5400.0000", ordered: "5100.0000", currency: "AED", pending: null, corrected: false };

  it("holds a line while a price correction or a scope change waits for the client", () => {
    expect(priceHoldReason({ ...base, pending: { reference: "CR-003", kind: "price_correction" } })).toBe("Kitchen cabinets: price correction CR-003 waits for the client's approval");
    expect(priceHoldReason({ ...base, pending: { reference: "CR-004", kind: "addition" } })).toBe("Kitchen cabinets: change CR-004 waits for the client's decision");
  });

  it("holds a line whose ordered cost is above the agreed amount until a price correction is approved; QS approval never clears it", () => {
    expect(priceHoldReason({ ...base, ordered: "5400.0001" })).toMatch(/AED 5400\.00 ordered against AED 5400\.00 agreed; the client approves the price correction first/);
    expect(priceHoldReason({ ...base, ordered: "6000" })).toMatch(/AED 6000\.00 ordered against AED 5400\.00 agreed/);
    expect(priceHoldReason({ ...base, ordered: "6000", corrected: true })).toBeNull();
  });

  it("holds nothing at or under the agreed amount", () => {
    expect(priceHoldReason(base)).toBeNull();
    expect(priceHoldReason({ ...base, ordered: "5400.0000" })).toBeNull();
    expect(priceHoldReason({ ...base, ordered: "0" })).toBeNull();
  });
});
