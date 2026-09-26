import { describe, expect, it } from "vitest";
import type { TemplateLine } from "@/lib/quotation/types";
import { templateOps } from "./quote-templates";

const line = (fields: Partial<TemplateLine>): TemplateLine => ({ title: "Paint", description: "", unit: "sqm", quantity: "1", rate: "18", unitCost: "9", kind: "service", formula: null, length: null, width: null, height: null, count: null, markupPercent: "40", pricingMode: "rate", catalogItemId: null, workPackageId: null, optional: false, components: [], ...fields });

describe("inserting a template", () => {
  it("re-prices catalog items from the catalog and keeps other lines' rates, into the chosen area", () => {
    const ops = templateOps([line({ catalogItemId: "c1", quantity: "2", width: "1", height: "2" }), line({ formula: "wall", length: "4", height: "2.7" })], "area-1", false);
    expect(ops[0]).toMatchObject({ op: "catalog", itemId: "c1", line: { areaId: "area-1", quantity: "2", width: "1", height: "2" } });
    expect(ops[1]).toMatchObject({ op: "upsert", line: { title: "Paint", rate: "18", formula: "wall", areaId: "area-1" } });
    expect((ops[1] as { line: Record<string, unknown> }).line.unitCost).toBeUndefined();
    expect(new Set(ops.map((op) => (op as { line: { id: string } }).line.id)).size).toBe(2);
  });
});
