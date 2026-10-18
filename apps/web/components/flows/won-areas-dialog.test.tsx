import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { translatorFor } from "@/lib/i18n/keys";
import { areasFor, areasText, WonAreasDialog, wonAreasRules } from "./won-areas-dialog";

const t = translatorFor({});
afterEach(() => vi.unstubAllGlobals());

describe("areas after Won (PLM-098)", () => {
  it("default to every area, and read a path's own rule before the type's", () => {
    expect(areasText(areasFor([], null), t)).toBe("Every area");
    const rules = [{ furniturePath: null, areas: ["supply" as const, "delivery" as const], version: 1 }, { furniturePath: "take_home_now", areas: [], version: 1 }];
    expect(areasText(areasFor(rules, "take_home_now"), t)).toBe("None");
    expect(areasText(areasFor(rules, "bespoke"), t)).toBe("Supply, Delivery");
  });

  it("save no rule when every path shows every area, else the type's and only the paths that differ", () => {
    const all = ["planning", "production", "supply", "delivery", "selection"] as const;
    expect(wonAreasRules({ "": [...all], bespoke: [...all] }, ["bespoke"])).toEqual([]);
    expect(wonAreasRules({ "": ["delivery"], bespoke: ["delivery"], take_home_now: [] }, ["bespoke", "take_home_now"]))
      .toEqual([{ furniturePath: null, areas: ["delivery"] }, { furniturePath: "take_home_now", areas: [] }]);
  });

  it("are chosen per path in the steps editor and saved with the versions seen", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit = {}) => {
      if (init.method === "PUT") sent.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ flowId: "f1", areas: ["planning", "production", "supply", "delivery", "selection"], furniturePaths: ["take_home_now"], rules: [] }) };
    }));
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<DesignSystemProvider><WonAreasDialog workspaceId="w1" flowId="f1" typeName="Furniture only" onClose={onClose} /></DesignSystemProvider>);
    await screen.findByText("A · Take home now");
    const boxes = screen.getAllByRole("checkbox", { name: "Planning" });
    expect(boxes).toHaveLength(2);
    // The type drops Planning: the paths that followed it drop it too.
    await user.click(boxes[0]);
    expect(screen.getAllByRole("checkbox", { name: "Planning" })[1]).not.toBeChecked();
    // Take home now (A) uses nothing after Won.
    for (const name of ["Production", "Supply", "Delivery", "Material selection"]) await user.click(screen.getAllByRole("checkbox", { name })[1]);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toEqual([{ rules: [{ furniturePath: null, areas: ["production", "supply", "delivery", "selection"] }, { furniturePath: "take_home_now", areas: [] }], versions: "" }]));
    expect(onClose).toHaveBeenCalled();
  });
});
