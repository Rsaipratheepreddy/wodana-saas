import sharp from "sharp";
import { renderChangeDocument, type ChangeDocument } from "../change-requests/change-request-pdf";
import { introPagePdf } from "../proposals/intro-deck";
import { presentForClient } from "../proposals/markup-disclosure";
import type { PdfLetterhead } from "../proposals/pdf-letterhead";
import { appendCertificate, renderProposal, sha256, type QuotationPage } from "../proposals/proposal-pdf";
import { priceQuote } from "../quotation/quote-pricing";

/**
 * Realistic sample documents for render tests and for reviewing the document theme by eye (`scripts/render-document-samples.ts`):
 * a long quotation in each disclosure mode, a quotation for a client with an Arabic name, an Indian GST quotation, a
 * change request and a signed copy with its certificate. Made-up businesses only.
 */
export type SampleDocument = { name: string; bytes: Uint8Array; outline: string };

const ITEMS: Array<[string, string, string, string, string, string]> = [
  // area, title, quantity, unit, rate, cost
  ["Living room", "Feature wall cladding in fluted oak veneer with concealed LED cove, including substructure and finishing", "18.5", "sqm", "420", "300"],
  ["Living room", "Gypsum false ceiling with shadow gap", "42", "sqm", "95", "70"],
  ["Living room", "TV unit, wall-hung, 2400 mm, lacquered MDF with walnut top", "1", "nos", "6800", "5100"],
  ["Kitchen", "Kitchen base cabinets, moisture-resistant MDF carcass, soft-close hardware (Blum)", "6.2", "rm", "1850", "1350"],
  ["Kitchen", "Quartz countertop 20 mm, Calacatta finish, with undermount sink cut-out", "7.4", "rm", "1250", "900"],
  ["Kitchen", "Backsplash tiling, 600 × 1200 porcelain", "9", "sqm", "180", "130"],
  ["Master bedroom", "Wardrobe, floor-to-ceiling, 3 m wide, with internal drawers and LED profile", "1", "nos", "14500", "10800"],
  ["Master bedroom", "Upholstered bed headboard, 2.2 m, performance fabric", "1", "nos", "3900", "2700"],
  ["Master bedroom", "Engineered oak flooring, herringbone, including underlay", "28", "sqm", "260", "190"],
  ["Guest bathroom", "Vanity unit with stone top and mirror cabinet", "1", "nos", "4200", "3100"],
  ["Guest bathroom", "Wall and floor tiling, large format", "22", "sqm", "210", "150"],
  ["", "Site protection, debris removal and final deep cleaning", "1", "lot", "2500", "1800"],
  ["", "Design supervision and project management", "1", "lot", "6000", "0"],
];

async function logo(text: string, colour: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><rect width="120" height="120" rx="24" fill="${colour}"/><text x="60" y="80" font-family="Helvetica" font-size="64" font-weight="700" fill="#fff" text-anchor="middle">${text}</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).png().toBuffer());
}

export async function sampleLetterhead(country: "AE" | "IN" = "AE"): Promise<PdfLetterhead> {
  return country === "AE"
    ? { name: "Studio Meridian Interiors LLC", lines: ["Licence 1234567 · TRN 100123456700003", "Office 1204, Bay Square Building 3, Business Bay, Dubai", "+971 4 123 4567 · hello@studiomeridian.example"],
      footer: "Studio Meridian Interiors LLC · Registered in Dubai · Bank: Example Bank, IBAN AE07 0331 2345 6789 0123 456", header: null, logo: await logo("SM", "#1F5C4F") }
    : { name: "Kalpa Design Studio Pvt Ltd", lines: ["CIN U74999MH2019PTC123456 · GSTIN 27AAPFU0939F1ZV", "4th Floor, Kamala Mills, Lower Parel, Mumbai, Maharashtra 400013", "+91 22 4000 1234 · studio@kalpa.example"],
      footer: "Kalpa Design Studio Pvt Ltd · Bank: Example Bank, A/c 1234567890, IFSC EXMP0001234", header: null, logo: await logo("K", "#8A3B12") };
}

function quotation(mode: "all_inclusive" | "disclosed_markup" | "fee_based", letterhead: PdfLetterhead, overrides: Partial<QuotationPage> = {}, taxRate = "5", decimals = 2): QuotationPage {
  const lines = ITEMS.map(([, title, quantity, unit, rate, cost], index) => ({ id: `line-${index + 1}`, title, quantity, unit, rate, unitCost: cost === "0" ? null : cost, optional: index === 7 }));
  const pricing = priceQuote(lines.map((line) => ({ ...line, areaKey: "general", tradeKey: "none", taxRate })), [], { currencyDecimals: decimals, pricesIncludeTax: false, rounding: "line" });
  const groups = new Map<string, string[]>();
  ITEMS.forEach(([area], index) => groups.set(area || "General", [...(groups.get(area || "General") ?? []), `line-${index + 1}`]));
  return {
    brand: { name: "Studio Meridian", accent: "#1F5C4F" }, letterhead, title: "Villa 14 interior fit-out", reference: "SM-QUO-2026-00012", revision: 2,
    issuedOn: "2026-10-12", validUntil: "2026-11-11", locale: "en-AE",
    client: { name: "Aisha Rahman", project: "Villa 14, Arabian Ranches 2", address: "Villa 14, Street 7, Arabian Ranches 2, Dubai" },
    currency: "AED", decimals, taxLabel: "VAT",
    presentation: presentForClient(lines, pricing, mode, decimals),
    groups: [...groups.entries()].map(([name, lineIds]) => ({ name, lineIds })),
    descriptions: { "line-1": "Includes 3D-approved pattern; veneer sample to be signed off before ordering.", "line-7": "Internal layout as per drawing WD-07 rev B." },
    paymentTerms: [{ title: "Advance", percent: 40, trigger: "On signing" }, { title: "Carpentry start", percent: 30, trigger: "Before carpentry" }, { title: "Handover", percent: 30, trigger: "On handover" }],
    terms: "Prices are valid for 30 days from the date above. Any work not listed is excluded and will be quoted as a change request.\nMaterials are subject to availability; equivalent alternatives will be proposed for approval.",
    exclusions: "Loose furniture, appliances and authority approval fees.",
    ...overrides,
  };
}

const change = (letterhead: PdfLetterhead): ChangeDocument => ({
  brandName: "Studio Meridian", accent: "#1F5C4F", letterhead, reference: "SM-CR-2026-0007", title: "Add a study nook in the guest bedroom", locale: "en-AE",
  description: "The client asked for a built-in study desk with overhead shelving in the guest bedroom, and to replace the planned wallpaper with paint.",
  designImpact: "Desk and shelving follow the master wardrobe finish (walnut veneer). Electrical: two extra sockets and a USB point above the desk.",
  project: "PRJ-0042 · Villa 14", clientName: "Aisha Rahman", issuedOn: "2026-10-12", currency: "AED", decimals: 2,
  lines: [
    { action: "add", title: "Built-in study desk, 1.6 m, walnut veneer, with cable management", room: "Guest bedroom", quantity: "1.000", unit: "nos", unitPrice: "3800.00", amount: "3800.00" },
    { action: "add", title: "Open shelving above desk, 3 shelves", room: "Guest bedroom", quantity: "1.000", unit: "nos", unitPrice: "1450.00", amount: "1450.00" },
    { action: "add", title: "Additional sockets and USB point", room: "Guest bedroom", quantity: "3.000", unit: "nos", unitPrice: "180.00", amount: "540.00" },
    { action: "omit", title: "Feature wallpaper", room: "Guest bedroom", quantity: "14.000", unit: "sqm", unitPrice: "120.00", amount: "-1680.00" },
  ],
  priceImpact: "4110.00", timeImpactDays: 4, handoverBefore: "2026-12-10", handoverAfter: "2026-12-16",
});

export async function renderSampleDocuments(): Promise<SampleDocument[]> {
  const ae = await sampleLetterhead("AE");
  const india = await sampleLetterhead("IN");
  const out: SampleDocument[] = [];
  const all = await renderProposal([], quotation("all_inclusive", ae));
  out.push({ name: "SM-QUO-2026-00012 Aisha Rahman (all-inclusive)", ...all });
  out.push({ name: "SM-QUO-2026-00012 Aisha Rahman (disclosed markup)", ...await renderProposal([], quotation("disclosed_markup", ae)) });
  out.push({ name: "SM-QUO-2026-00013 Design fee proposal (fee-based)", ...await renderProposal([], quotation("fee_based", ae, { title: "Design and supervision fee proposal", reference: "SM-QUO-2026-00013", revision: 1 })) });
  out.push({ name: "SM-QUO-2026-00014 Arabic client", ...await renderProposal([], quotation("all_inclusive", ae, {
    reference: "SM-QUO-2026-00014", revision: 1, client: { name: "عائشة الرحمن", project: "فيلا ١٤، المرابع العربية ٢", address: "فيلا 14، شارع 7، المرابع العربية 2، دبي" },
  })) });
  out.push({ name: "KDS-QUO-2026-00031 Rohan Mehta (GST)", ...await renderProposal([], quotation("all_inclusive", india, {
    brand: { name: "Kalpa Design Studio", accent: "#8A3B12" }, reference: "KDS-QUO-2026-00031", revision: 1, currency: "INR", taxLabel: "GST", locale: "en-IN",
    client: { name: "Rohan Mehta", project: "Flat 1802, Lodha Park", address: "Flat 1802, Tower 3, Lodha Park, Worli, Mumbai, Maharashtra 400018" },
  }, "18")) });
  const changed = await renderChangeDocument(change(ae));
  out.push({ name: "SM-CR-2026-0007 Aisha Rahman", ...changed });
  const signed = await appendCertificate(all.bytes, {
    requestId: "5d0c6c2e-8a44-4b8f-9e0a-2f1b7c3d9e10", documentTitle: "Villa 14 interior fit-out", reference: "SM-QUO-2026-00012", documentSha256: sha256(all.bytes),
    signer: { name: "Aisha Rahman", email: "aisha.rahman@example.com", phone: "+971 50 123 4567" }, signedAt: "2026-10-12T09:41:07.000Z", ip: "203.0.113.24",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    signature: { kind: "typed", text: "Aisha Rahman" }, brandName: "Studio Meridian",
  });
  out.push({ name: "SM-QUO-2026-00012 Aisha Rahman (signed)", bytes: signed, outline: "" });
  out.push({ name: "Intro deck page 3 Aisha Rahman", outline: "", bytes: await introPagePdf({
    brand: { name: "Studio Meridian", accent: "#1F5C4F" }, title: "Villa 14 interior fit-out", reference: "OPP-0088", clientName: "Aisha Rahman", enquiryType: "design_and_build",
    clientType: "homeowner", location: "Arabian Ranches 2, Dubai", area: "420", areaUnit: "sqm", spaces: 6, clientEmail: "aisha.rahman@example.com", floorPlan: true,
    answers: [{ label: "Style", value: "Warm minimal, natural oak and stone" }, { label: "Budget", value: "AED 350,000 – 450,000" }, { label: "Move-in", value: "Before February" }],
  }) });
  return out;
}
