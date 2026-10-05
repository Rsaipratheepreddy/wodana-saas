import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { VendorOrderForm } from "./vendor-order-form";

// §5c D.4: the supplier's update form is one column, label above field, with its submit at the end and no explanatory line.
afterEach(() => { vi.unstubAllGlobals(); window.location.hash = ""; });

const order = {
  brand: null, expiresAt: "2099-01-01T00:00:00Z",
  order: { number: "PO-12", title: "Kitchen worktop", vendor: "Stone Co", kind: "material", quantity: 4, unit: "m", currency: "USD", status: "approved", promisedDate: "2026-10-20",
    specification: "", workTitle: "", workArea: "", accepted: 0, rejected: 0, acknowledgement: "", updates: [] },
};

describe("Supplier order form", () => {
  it("notifies a delivery in one column with Submit at the end", async () => {
    window.location.hash = "#token=t1";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => order })));
    render(<DesignSystemProvider><VendorOrderForm /></DesignSystemProvider>);
    await userEvent.click(await screen.findByRole("button", { name: /Notify delivery/ }));
    const form = (await screen.findByRole("heading", { name: "Notify delivery" })).closest("form")!;
    expect(form.querySelectorAll(".wd-form-row").length).toBe(0);
    expect(form).not.toHaveTextContent("Quantity, date and delivery reference");
    expect(form.querySelector("[class*=formActions]")?.lastElementChild?.textContent).toBe("Submit update");
  });

  it("keeps two-column grids out of the projects form styles, except read-only displays and board layouts", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fit|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const allowed: Record<string, RegExp> = {
      // The order's facts on a phone (read-only), not form fields.
      "vendor-order.module.css": /^\.orderSummary dl$/,
      // Portfolio metrics, summary cards and task table rows of the project workspace (displays, no form fields).
      "project-workspace.module.css": /^\.(grid|grid\.reportContext|summaryGrid|portfolioMetrics|reading|taskScroll tr)$/,
      // The work board's filter popover (a toolbar filter panel).
      "global-work-board.module.css": /^\.filterPanel$/,
    };
    for (const sheet of readdirSync(__dirname).filter((name) => name.endsWith(".module.css"))) {
      const css = readFileSync(join(__dirname, sheet), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const offenders = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => twoColumns.test(body))
        .map(([, selector]) => selector.trim())
        .filter((selector) => !allowed[sheet]?.test(selector));
      expect(offenders, sheet).toEqual([]);
    }
  });
});
