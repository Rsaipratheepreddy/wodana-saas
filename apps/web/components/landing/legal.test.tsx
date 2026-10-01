import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "@/lib/i18n/messages";
import { COMPANY, ContactDetails, LegalDocument, PRIVACY_SECTIONS, TERMS_SECTIONS, legalUpdatedLabel, type LegalSection } from "./legal";
import { LEGAL_LINKS } from "./marketing-links";

const t = translator("en");
const mailto = `mailto:${COMPANY.supportEmail}`;

/** Every English label a legal page can show. */
function labels(sections: LegalSection[]) {
  return sections.flatMap((section) => [section.title, ...section.paragraphs, ...(section.bullets ?? []), ...(section.closing ?? [])]).map((key) => t(key));
}

describe("legal pages", () => {
  it("dates the documents 1 October 2026 in the visitor's language", () => {
    expect(legalUpdatedLabel("en")).toBe("1 October 2026");
    expect(legalUpdatedLabel("ar")).toContain("2026");
  });

  it("writes plainly, without dashes", () => {
    for (const text of [...labels(PRIVACY_SECTIONS), ...labels(TERMS_SECTIONS), ...LEGAL_LINKS.map((link) => t(link.label))]) {
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("numbers the privacy policy's sections and names the company and its address", () => {
    render(<LegalDocument sections={PRIVACY_SECTIONS} t={t} updated="1 October 2026" />);
    expect(screen.getByText("Last updated 1 October 2026")).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Who we are", "Information we collect", "How we use it", "AI features", "Where data is stored", "Sharing",
      "Retention and deletion", "Your rights", "Children", "Changes to this policy"]);
    expect(screen.getByText(COMPANY.name)).toBeInTheDocument();
    expect(screen.getByText("Hyderabad, Telangana 500038")).toBeInTheDocument();
    expect(screen.getByText(/precise location, only at the moment a user checks in or out/i)).toBeInTheDocument();
  });

  it("makes the support address a mail link wherever a section names it", () => {
    render(<LegalDocument sections={TERMS_SECTIONS} t={t} updated="1 October 2026" />);
    const links = screen.getAllByRole("link", { name: COMPANY.supportEmail });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) expect(link).toHaveAttribute("href", mailto);
    expect(screen.getByRole("heading", { level: 2, name: "Governing law" })).toBeInTheDocument();
    expect(screen.getByText(/courts of Hyderabad/)).toBeInTheDocument();
  });

  it("gives the contact page support, sales, the address and the legal pages", () => {
    render(<ContactDetails t={t} />);
    expect(screen.getByRole("link", { name: COMPANY.supportEmail })).toHaveAttribute("href", mailto);
    expect(screen.getByRole("link", { name: "For sales enquiries" })).toHaveAttribute("href", "/contact-sales");
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(within(screen.getByText(COMPANY.name).closest("address")!).getByText("India")).toBeInTheDocument();
  });

  it("links the footer to the privacy policy, the terms and the contact page", () => {
    expect(LEGAL_LINKS.map((link) => [link.href, t(link.label)])).toEqual([["/privacy", "Privacy policy"], ["/terms", "Terms"], ["/contact", "Contact"]]);
  });
});
