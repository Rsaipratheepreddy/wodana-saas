import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { PortalSite } from "@/lib/client-portal/types";
import { PortalFrame } from "./portal-frame";

const site = (catalogueUrl: string | null): PortalSite => ({
  slug: "studio", brand: { name: "Studio Interiors", logoUrl: null, primaryColor: null, secondaryColor: null, headingFont: null, bodyFont: null }, welcomeTitle: "", welcomeText: "",
  support: { phone: "", email: "", whatsapp: "" }, region: { locale: "en-US", currency: "USD", timeZone: "UTC", country: "US" }, signIn: { channels: ["email"], demo: false },
  gallerySlug: null, catalogueUrl,
});

describe("the firm's online catalogue in the portal", () => {
  it("links the catalogue the firm set, in a new tab", () => {
    render(<DesignSystemProvider><PortalFrame site={site("https://shop.example.com/collections/all")}><p>Home</p></PortalFrame></DesignSystemProvider>);
    const link = screen.getByRole("link", { name: "Our catalogue" });
    expect(link).toHaveAttribute("href", "https://shop.example.com/collections/all");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows nothing when the firm has none", () => {
    render(<DesignSystemProvider><PortalFrame site={site(null)}><p>Home</p></PortalFrame></DesignSystemProvider>);
    expect(screen.queryByRole("link", { name: "Our catalogue" })).not.toBeInTheDocument();
  });
});
