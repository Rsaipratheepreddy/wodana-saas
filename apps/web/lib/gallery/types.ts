import type { PublicEnquiryForm } from "@/lib/crm/lead-forms";
import type { DocumentStyleId } from "@/lib/quotation/types";

export type GalleryKind = "service" | "product" | "project" | "testimonial";
export type GallerySectionKey = "services" | "products" | "projects" | "testimonials" | "about" | "contact";
export type GallerySettings = {
  slug: string; status: "draft" | "published"; style: DocumentStyleId; accent: string | null; headline: string; intro: string; about: string; heroImageId: string | null;
  contactPhone: string; contactEmail: string; contactWhatsapp: string; contactAddress: string; leadFormId: string | null;
  enquirySource: string | null; enquiryChannel: string | null; showPrices: boolean; sections: Array<{ key: GallerySectionKey; visible: boolean }>; version: number; publishedAt: string | null;
  /** What visitors see; anything off is hidden. */
  display: GalleryDisplay;
};
export type GalleryDisplay = { descriptions: boolean; list: boolean; search: boolean; chips: boolean; contact: boolean };
export const DEFAULT_DISPLAY: GalleryDisplay = { descriptions: true, list: true, search: true, chips: true, contact: true };
export type GalleryItem = {
  id: string; kind: GalleryKind; title: string; subtitle: string; body: string; priceFrom: string | null; priceUnit: string; catalogItemId: string | null;
  rating: number | null; position: number; visible: boolean; version: number; images: Array<{ id: string; source: "gallery" | "catalog" }>;
};
export type GalleryBrand = { name: string; logo: string; primaryColor: string; accentColor: string };
/** What the page shows: the owner's editor passes the draft; the public page the published gallery. */
export type GalleryContent = {
  settings: Omit<GallerySettings, "leadFormId" | "enquirySource" | "enquiryChannel" | "version" | "status"> & Partial<GallerySettings>;
  items: GalleryItem[]; brand: GalleryBrand; currency: string; form?: PublicEnquiryForm | null;
};
export type GalleryEditorData = GalleryContent & { settings: GallerySettings; forms: Array<{ id: string; title: string; status: string }>; canManage: boolean };
