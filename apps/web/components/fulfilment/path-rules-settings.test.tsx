import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { translatorFor } from "@/lib/i18n/keys";
import type { RulesState } from "@/lib/fulfilment/types";
import { PathRulesSettingsPage, ruleSummary } from "./path-rules-settings";

const t = translatorFor({});
afterEach(() => vi.unstubAllGlobals());

const base = { boqRequired: false, reserveOn: "quote_accepted" as const, deductOn: "won" as const, leadMinDays: 3, leadMaxDays: 4, leadFrom: "won" as const, leadFromCatalogue: false, takeFromLocationId: "p1" };
const state: RulesState = {
  qsReview: true, places: [{ id: "p1", name: "Showroom" }],
  flows: [{ id: "f1", name: "Furniture", enquiryTypes: ["Furniture Only"], furniture: true, rules: [
    { ...base, furniturePath: null, reserveOn: "none", deductOn: "none", leadMinDays: null, leadMaxDays: null, takeFromLocationId: null, version: 1 },
    { ...base, furniturePath: "in_stock_delivery", version: 2 },
  ] }],
};

describe("orders by path (PLM-083/125/126)", () => {
  it("summarises a rule in one line", () => {
    expect(ruleSummary(t, base, state.places)).toBe("No BOQ · Held: when the client approves the quotation · Out: at won · From Showroom · 3–4 working days from Won");
    expect(ruleSummary(t, { ...base, boqRequired: null, reserveOn: "none", deductOn: "none", leadMinDays: null, leadMaxDays: null, leadFromCatalogue: true, takeFromLocationId: null }, []))
      .toBe("BOQ as in quotation settings · Stock untouched · Lead time from the catalogue");
  });

  it("changes one path and saves the type's rules with the versions seen", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit = {}) => {
      if (init.method === "PUT") sent.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => state };
    }));
    const user = userEvent.setup();
    render(<DesignSystemProvider><PathRulesSettingsPage workspaceId="w1" /></DesignSystemProvider>);
    await user.click(await screen.findByRole("button", { name: "Change B · In-stock delivery" }));
    const to = screen.getByRole("textbox", { name: "Lead time to" });
    await user.clear(to);
    await user.type(to, "6");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ versions: [":1", "in_stock_delivery:2"], rules: [
      { furniturePath: null, boqRequired: false, reserveOn: "none", deductOn: "none", leadMinDays: null, leadMaxDays: null, leadFrom: "won", leadFromCatalogue: false, takeFromLocationId: null },
      { ...base, leadMaxDays: 6, furniturePath: "in_stock_delivery" },
    ] });
  });
});
