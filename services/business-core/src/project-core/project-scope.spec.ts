import { describe, expect, it } from "vitest";
import { Dec } from "../catalog-core/decimal";
import { lineCost, withLineDetails, type LineCostSource, type ScopeLineLinks } from "./project-scope";

const line = (id: string, over: Partial<{ quantity: string; net: string | null; status: string }> = {}) => ({ id, quantity: "4.5000", net: "5400.0000", status: "active", title: id, ...over });
const source = (unitCost: string | null, committed = "0", committedForeign = 0): LineCostSource => ({ unitCost, committed: Dec.of(committed), committedForeign });

describe("internal BOQ (PLM-170)", () => {
  it("works a line's estimate, what is committed and its margin out exactly, to the currency's places", () => {
    expect(lineCost(line("a"), source("800", "2100.5"), 2, true)).toEqual({
      unitCost: "800.0000", estimate: "3600.0000", committed: "2100.5000", committedForeign: 0, margin: "1800.0000", marginPercent: "33.3",
    });
    // No unit cost on the quotation: no estimate and no margin, but still what was ordered.
    expect(lineCost(line("a"), source(null, "120"), 2, true)).toMatchObject({ unitCost: null, estimate: null, committed: "120.0000", margin: null, marginPercent: null });
    // Nothing ordered and nothing costed.
    expect(lineCost(line("a"), undefined, 2, true)).toEqual({ unitCost: null, estimate: null, committed: "0.0000", committedForeign: 0, margin: null, marginPercent: null });
    // A line removed by a variation has no estimate or margin any more.
    expect(lineCost(line("a", { status: "omitted", quantity: "0", net: "0" }), source("800", "500"), 2, true)).toMatchObject({ estimate: null, margin: null, committed: "500.0000" });
    // Orders in another currency are counted, never added.
    expect(lineCost(line("a"), source("800", "100", 2), 2, true).committedForeign).toBe(2);
  });

  it("gives the margin only to someone who sees margins and the amount", () => {
    expect(lineCost(line("a"), source("800"), 2, false)).toMatchObject({ estimate: "3600.0000", margin: null, marginPercent: null });
    expect(lineCost(line("a", { net: null }), source("800"), 2, true)).toMatchObject({ estimate: "3600.0000", margin: null, marginPercent: null });
  });

  it("never puts a cost field on a line for someone without cost access, and names every line's orders for everyone", () => {
    const links = new Map<string, ScopeLineLinks>([["a", { purchaseOrders: [{ id: "po1", number: "PO-0001", status: "sent" }], workOrders: [{ id: "wo1", number: 3, status: "released" }] }]]);
    const costs = new Map([["a", source("800", "100")]]);
    const hidden = withLineDetails([line("a"), line("b")], links, costs, { costs: false, margin: false }, 2);
    expect(hidden.map((item) => "cost" in item)).toEqual([false, false]);
    expect(JSON.stringify(hidden)).not.toMatch(/unitCost|estimate|margin|committed/);
    expect(hidden[0]).toMatchObject({ purchaseOrders: [{ number: "PO-0001" }], workOrders: [{ number: 3 }] });
    expect(hidden[1]).toMatchObject({ purchaseOrders: [], workOrders: [] });
    // Cost access without the costs read (never happens, but stays safe).
    expect("cost" in withLineDetails([line("a")], links, null, { costs: true, margin: true }, 2)[0]).toBe(false);
    const shown = withLineDetails([line("a"), line("b")], links, costs, { costs: true, margin: true }, 2);
    expect(shown[0].cost).toMatchObject({ estimate: "3600.0000", committed: "100.0000", margin: "1800.0000" });
    expect(shown[1].cost).toMatchObject({ estimate: null, committed: "0.0000", margin: null });
    // Costs without margin (projects.costs.view on the team): the estimate, never the margin.
    expect(withLineDetails([line("a")], links, costs, { costs: true, margin: false }, 2)[0].cost).toMatchObject({ estimate: "3600.0000", margin: null, marginPercent: null });
  });
});
