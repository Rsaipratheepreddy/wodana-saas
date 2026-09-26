import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "@/design-system";
import type { GalleryContent, GalleryItem } from "@/lib/gallery/types";
import { GalleryView } from "./gallery-view";

const item = (fields: Partial<GalleryItem>): GalleryItem => ({ id: crypto.randomUUID(), kind: "service", title: "", subtitle: "", body: "", priceFrom: null, priceUnit: "", catalogItemId: null, rating: null, position: 0, visible: true, version: 1, images: [], ...fields });
const kitchens = item({ id: "11111111-1111-4111-8111-111111111111", title: "Kitchens", priceFrom: "38000", priceUnit: "kitchen", images: [{ id: "i1", source: "gallery" }] });
const content: GalleryContent = {
  settings: { slug: "palm-studio", style: "atelier", accent: null, headline: "Homes made calm", intro: "Design and build.", about: "", heroImageId: null, contactPhone: "+971 4 000 0000", contactEmail: "", contactWhatsapp: "+971 50 000 0000", contactAddress: "", showPrices: true,
    sections: [{ key: "services", visible: true }, { key: "products", visible: true }, { key: "projects", visible: true }, { key: "testimonials", visible: true }, { key: "about", visible: true }, { key: "contact", visible: true }], publishedAt: null },
  items: [kitchens, item({ kind: "testimonial", title: "Maya R.", body: "Calm and on time.", rating: 5 }), item({ kind: "product", title: "Hidden", visible: false })],
  brand: { name: "Palm Studio", logo: "", primaryColor: "#1f6f5c", accentColor: "#1f6f5c" }, currency: "AED",
  form: { title: "Enquiry", description: "", revision: "r1", questions: [{ id: "q1", type: "text", title: "Your name", required: true, field: "displayName", options: [] }], defaultCountryCode: "AE" } as never,
};

describe("company gallery", () => {
  afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

  it("shows visible items as a searchable, filterable wall with prices and contact links", async () => {
    render(<DesignSystemProvider><GalleryView content={content} imageUrl={(id) => `/img/${id}`} locale="en" /></DesignSystemProvider>);
    expect(screen.getByRole("heading", { name: "Homes made calm" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Services/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Products/ })).not.toBeInTheDocument();
    expect(screen.getByText("From AED 38,000 / kitchen")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /WhatsApp/ })[0]).toHaveAttribute("href", "https://wa.me/971500000000");
    expect(screen.getByLabelText("5 out of 5")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search the gallery" }), "wardrobe");
    expect(screen.getByText("Nothing matches “wardrobe”.")).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search the gallery" }));
    await userEvent.click(screen.getByRole("button", { name: "Open Kitchens" }));
    expect(screen.getByRole("dialog", { name: "Kitchens" })).toHaveTextContent("From AED 38,000 / kitchen");
  });

  it("keeps a list and sends it through the firm's enquiry form", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ received: true }) }));
    vi.stubGlobal("fetch", fetcher);
    render(<DesignSystemProvider><GalleryView content={content} imageUrl={(id) => `/img/${id}`} submitTo="/api/public-gallery/palm-studio/enquiries" locale="en" /></DesignSystemProvider>);
    await userEvent.click(screen.getByRole("button", { name: "Add Kitchens to your list" }));
    expect(JSON.parse(window.localStorage.getItem("wodana.gallery.palm-studio")!)).toEqual([kitchens.id]);
    await userEvent.click(screen.getByRole("button", { name: "My list, 1 items" }));
    const drawer = screen.getByRole("dialog", { name: "My list" });
    expect(within(drawer).getByText("Kitchens")).toBeInTheDocument();
    await userEvent.type(within(drawer).getByRole("textbox", { name: /Your name/ }), "Maya");
    await userEvent.click(within(drawer).getByRole("checkbox"));
    await userEvent.click(within(drawer).getByRole("button", { name: /Submit|Send/ }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/public-gallery/palm-studio/enquiries", expect.objectContaining({ method: "POST" })));
    const body = JSON.parse(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ selection: [kitchens.id], revision: "r1", serviceConsent: true });
    expect(await within(drawer).findByText("Thank you")).toBeInTheDocument();
    expect(window.localStorage.getItem("wodana.gallery.palm-studio")).toBe("[]");
  });
});
