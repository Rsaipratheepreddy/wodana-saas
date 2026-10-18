import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { CommercialState } from "@/lib/commercial/types";
import { AgreementPayments, CommercialRequests } from "./commercial-workflows";

// §5c D.4: Commercial dialogs are one column, label above field, sections divided by a hairline under a title, Save at
// the bottom end. FormRow stays only for an amount and what it is counted in (the commission's currency or percentage).
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))); });
afterEach(() => vi.unstubAllGlobals());

const sectionTitles = (dialog: HTMLElement) => [...dialog.querySelectorAll(".wd-form-section-title")].map((title) => title.textContent);
const rows = (dialog: HTMLElement) => dialog.querySelectorAll(".wd-form-row").length;
const saveAtTheEnd = (dialog: HTMLElement, name: string) => {
  const actions = dialog.querySelector(".wd-form-footer .wd-dialog-actions");
  expect(actions?.lastElementChild?.textContent).toBe(name);
};

const state = (quote: Record<string, unknown>) => ({
  workspaceId: "w", caseId: "c", currency: "USD", customerName: "Sofia", canEdit: true, canApprove: true, canVerifyFinance: false, contacts: [],
  data: {
    revision: 3, requests: [], audit: [], release: null, receipts: [], payments: [],
    agreement: { status: "draft", quoteId: "q1", reference: "AGR-1", terms: "", evidence: "" },
    quotes: [{ id: "q1", kind: "quotation", number: 1, currency: "USD", total: 10000, paymentTerms: [], ...quote }],
  },
}) as unknown as CommercialState;
const view = (ui: React.ReactNode) => render(<DesignSystemProvider>{ui}</DesignSystemProvider>);

describe("Commercial form dialogs", () => {
  it("requests a client decision in one column, the choices in their own section", async () => {
    view(<CommercialRequests state={state({ status: "issued", issuedAt: "2026-09-18T08:00:00.000Z", approverId: "client", lines: [] })} run={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Request client decision" }));
    const dialog = await screen.findByRole("dialog", { name: "Request a client decision" });
    expect(sectionTitles(dialog)).toEqual(["Choices"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Send decision request");
  });

  it("raises a change request in one column, the follow-up in its own section", async () => {
    view(<CommercialRequests state={state({ status: "accepted", lines: [{ id: "line", title: "Wardrobe", room: "Bedroom", quantity: 1, unit: "nos" }] })} run={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "New change request" }));
    const dialog = await screen.findByRole("dialog", { name: "New change request" });
    expect(sectionTitles(dialog).at(-1)).toBe("Follow-up");
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Create change request");
  });

  it("adds a payment milestone in one column", async () => {
    view(<AgreementPayments initialView="payments" state={state({ status: "accepted", lines: [] })} run={vi.fn()} busy={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Add milestone" }));
    const dialog = await screen.findByRole("dialog", { name: "Add milestone" });
    expect(sectionTitles(dialog)).toEqual(["Required before"]);
    expect(rows(dialog)).toBe(0);
    saveAtTheEnd(dialog, "Save milestone");
  });

  it("keeps two-column grids out of the Commercial dialog styles", () => {
    const twoColumns = /grid-template-columns:\s*(repeat\(2,|repeat\(auto-fi(t|ll)|1fr 1fr|minmax\(0, ?1fr\) minmax\(0, ?1fr\))/;
    const allowed = new RegExp([
      "^\\.grid$", // the quotation editor's own fields (the builder pass owns them)
      "^\\.(controlSummary|dealBanner)$", // read-only Deal File summary and banner
    ].join("|"));
    // The dialog stylesheets this module owns; the quotation builder and document sheets are not dialogs.
    for (const sheet of ["commercial", "client-payment-reports", "agreement-files", "controlled-change-case", "catalog-picker"]) {
      const css = readFileSync(join(__dirname, `${sheet}.module.css`), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "");
      const offenders = [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)]
        .filter(([, , body]) => twoColumns.test(body))
        .flatMap(([, selector]) => selector.split(",").map((part) => part.trim()))
        .filter((selector) => !allowed.test(selector));
      expect(offenders, `${sheet}.module.css`).toEqual([]);
    }
  });
});
