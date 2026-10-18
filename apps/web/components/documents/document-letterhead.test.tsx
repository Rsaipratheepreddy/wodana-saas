import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { DocumentLetterhead } from "@/lib/brand/letterhead";
import { LetterheadFooter, LetterheadHeader } from "./document-letterhead";

const letterhead: DocumentLetterhead = { entityId: "e", legalName: "Studio Interiors LLC", taxLabel: "TRN", taxNumber: "100123456700003", licenceNumber: "TL-55",
  address: "Office 4, Dubai", phone: "+97141234567", email: "hello@studio.example", footer: "Registered in Dubai", logoUrl: null, headerUrl: null };
const show = (node: React.ReactNode) => render(<DesignSystemProvider>{node}</DesignSystemProvider>);

describe("document letterhead (PLM-112)", () => {
  it("prints the business's legal name, licence, tax number, address and contact, and its footer", () => {
    show(<><LetterheadHeader letterhead={letterhead} fallback={<strong>Brand</strong>} /><LetterheadFooter letterhead={letterhead} /></>);
    expect(screen.getByText("Studio Interiors LLC")).toBeInTheDocument();
    expect(screen.getByText("Licence TL-55 · TRN 100123456700003")).toBeInTheDocument();
    expect(screen.getByText("Office 4, Dubai")).toBeInTheDocument();
    expect(screen.getByText("+97141234567 · hello@studio.example")).toBeInTheDocument();
    expect(screen.getByText("Registered in Dubai")).toBeInTheDocument();
    expect(screen.queryByText("Brand")).not.toBeInTheDocument();
  });

  it("uses the letterhead image when the business has one, and the brand when there's no business", () => {
    const { unmount } = show(<LetterheadHeader letterhead={{ ...letterhead, headerUrl: "/api/auth/entity-image/w/a" }} />);
    expect(screen.getByRole("img", { name: "Studio Interiors LLC" })).toHaveAttribute("src", "/api/auth/entity-image/w/a");
    expect(screen.queryByText("Office 4, Dubai")).not.toBeInTheDocument();
    unmount();
    show(<><LetterheadHeader letterhead={null} fallback={<strong>Brand</strong>} /><LetterheadFooter letterhead={null} /></>);
    expect(screen.getByText("Brand")).toBeInTheDocument();
  });
});
