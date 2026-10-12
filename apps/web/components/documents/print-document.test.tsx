import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import { WorkspaceIdentityProvider } from "../workspace/workspace-identity";
import { DocumentSignatures, DocumentTotals, PrintDocument } from "./print-document";

const letterhead = {
  entityId: "e1", legalName: "Studio Meridian Interiors LLC", taxLabel: "TRN", taxName: "VAT", taxNumber: "100123456700003", licenceNumber: "1234567",
  address: "Office 1204, Business Bay, Dubai", phone: "+971 4 123 4567", email: null, footer: "Registered in Dubai", logoUrl: null, headerUrl: null,
};

describe("the shared printed document", () => {
  it("prints the letterhead, the document's name and number, its facts and parties, totals, signatures and footer", () => {
    render(<DesignSystemProvider><PrintDocument kind="Purchase order" number="PO-2026-00011" letterhead={letterhead} fileName={["PO-2026-00011", "Nile Timber"]}
      facts={[{ label: "Order date", value: "12 Oct 2026" }, { label: "Empty", value: "" }]} parties={[{ label: "Supplier", name: "Nile Timber", lines: ["Sara Haddad", null] }]}>
      <DocumentTotals label="Totals" rows={[{ key: "tax", label: "VAT", value: "AED 900.00" }, { key: "total", label: "Total", value: "AED 18,900.00", emphasis: true }]} />
      <DocumentSignatures boxes={[{ label: "Authorised by", name: "Olivia Owner" }]} />
    </PrintDocument></DesignSystemProvider>);
    const sheet = screen.getByRole("article", { name: "Purchase order PO-2026-00011" });
    expect(within(sheet).getByRole("heading", { level: 1, name: "Purchase order" })).toBeInTheDocument();
    expect(sheet).toHaveTextContent("Studio Meridian Interiors LLC");
    expect(sheet).toHaveTextContent("Licence 1234567 · TRN 100123456700003");
    expect(within(sheet).getByText("Order date").nextSibling).toHaveTextContent("12 Oct 2026");
    expect(within(sheet).queryByText("Empty")).not.toBeInTheDocument();
    expect(within(sheet).getByText("Nile Timber")).toBeInTheDocument();
    expect(within(sheet).getByText("AED 18,900.00").closest("[data-emphasis]")).not.toBeNull();
    expect(sheet).toHaveTextContent("Registered in Dubai");
    expect(sheet).toHaveTextContent("Powered by Wodana");
    expect(sheet.textContent).toMatchSnapshot();
    expect(document.title).toBe("PO-2026-00011 · Nile Timber");
    // A4 with page numbers in the page margin, at the inline end.
    const pageRules = () => [...document.querySelectorAll("style")].map((style) => style.textContent ?? "").find((css) => css.includes("@page"))!;
    const rules = pageRules();
    expect(rules).toMatch(/@page \{ size: A4; margin: 16mm 14mm 18mm;/);
    expect(rules).toContain('@bottom-right { content: "Page " counter(page) " of " counter(pages) "";');
    expect(screen.getByRole("button", { name: "Print or save as PDF" })).toBeInTheDocument();
  });

  it("uses the workspace's own name and logo without a letterhead, and puts the page number at the inline end right to left", () => {
    render(<DesignSystemProvider direction="rtl"><WorkspaceIdentityProvider identity={{ name: "Studio Meridian", logoUrl: "/logo.png" }}>
      <PrintDocument kind="Delivery note" number="Move 27" fileName={["Move 27"]}><p>Lines</p></PrintDocument>
    </WorkspaceIdentityProvider></DesignSystemProvider>);
    const sheet = screen.getByRole("article", { name: "Delivery note Move 27" });
    expect(within(sheet).getByText("Studio Meridian")).toBeInTheDocument();
    expect(sheet.querySelector("img")).toHaveAttribute("src", "/logo.png");
    expect([...document.querySelectorAll("style")].map((style) => style.textContent ?? "").find((css) => css.includes("@page"))).toContain("@bottom-left");
  });
});
