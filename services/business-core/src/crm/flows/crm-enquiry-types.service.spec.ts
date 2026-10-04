import { describe, expect, it } from "vitest";
import { CrmEnquiryTypesService } from "./crm-enquiry-types.service";
import { freeFlowCode } from "./enquiry-type-flows";

describe("enquiry types with their own steps", () => {
  it("refuses a create without a name, a colour it knows or exactly one source, before touching the database", async () => {
    const access = { withPermission: () => { throw new Error("must not run"); } } as never;
    const service = new CrmEnquiryTypesService(access);
    const actor = {} as never;
    await expect(service.create(actor, "w", { label: " ", blank: true })).rejects.toThrow(/name/);
    await expect(service.create(actor, "w", { label: "Kitchen", blank: true, color: 9 })).rejects.toThrow(/colour/);
    await expect(service.create(actor, "w", { label: "Kitchen" })).rejects.toThrow(/template, another enquiry type or blank/);
    await expect(service.create(actor, "w", { label: "Kitchen", blank: true, templateKey: "basic" })).rejects.toThrow(/template, another enquiry type or blank/);
    await expect(service.create(actor, "w", { label: "Kitchen", templateKey: "basic", copyFromTypeId: "t" })).rejects.toThrow(/template, another enquiry type or blank/);
    await expect(service.update(actor, "w", "t", { version: 1, label: "  " })).rejects.toThrow(/name/);
    await expect(service.update(actor, "w", "t", { version: 1, color: 0 })).rejects.toThrow(/colour/);
  });

  it("stores a type's flow under a code no other flow has", async () => {
    const db = (codes: string[]) => ({ query: async () => ({ rows: codes.map((code) => ({ code })) }) }) as never;
    expect(await freeFlowCode(db([]), "w", "furniture")).toBe("furniture");
    expect(await freeFlowCode(db(["furniture", "furniture_2"]), "w", "furniture")).toBe("furniture_3");
    expect(await freeFlowCode(db(["a".repeat(40)]), "w", "a".repeat(40))).toBe(`${"a".repeat(38)}_2`);
  });
});
