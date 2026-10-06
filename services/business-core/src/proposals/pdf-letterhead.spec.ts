import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { composeChangeDocument, type ChangeDocument } from "../change-requests/change-request-pdf";
import { letterheadLines } from "../workspaces/entity-letterhead";

const change: ChangeDocument = {
  brandName: "Studio", reference: "CR-001", title: "Add a wardrobe", description: "", designImpact: "", project: "PRJ-1", clientName: "A. Client", issuedOn: "2026-10-06",
  currency: "AED", decimals: 2, lines: [{ action: "add", title: "Wardrobe", room: "Bedroom", quantity: "1", unit: "nos", unitPrice: "1000", amount: "1000" }],
  priceImpact: "1000", timeImpactDays: 0, handoverBefore: null, handoverAfter: null,
};
const images = async (bytes: Uint8Array) => (Buffer.from(bytes).toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;

describe("the issuing business's letterhead on server-made PDFs (PLM-112)", () => {
  it("prints the licence, tax number, address and contact lines under the legal name", () => {
    expect(letterheadLines({ entityId: "e", legalName: "Studio Interiors LLC", taxLabel: "TRN", taxNumber: "100123456700003", licenceNumber: "TL-55", address: "Office 4, Dubai",
      phone: "+97141234567", email: null, footer: null, logoUrl: null, headerUrl: null, logoAssetId: null, headerAssetId: null }, { licence: "Licence", tax: "Tax no." }))
      .toEqual(["Licence TL-55 · TRN 100123456700003", "Office 4, Dubai", "+97141234567"]);
  });

  it("draws the header image and footer text, and keeps the brand when there is no letterhead", async () => {
    const header = new Uint8Array(await sharp({ create: { width: 1200, height: 160, channels: 3, background: "#203040" } }).png().toBuffer());
    const plain = await composeChangeDocument(change);
    const lettered = await composeChangeDocument({ ...change, letterhead: { name: "Studio Interiors LLC", lines: ["TRN 100123456700003"], footer: "Registered in Dubai", header, logo: null } });
    expect(await images(plain)).toBe(0);
    expect(await images(lettered)).toBe(1);
    expect((await PDFDocument.load(lettered)).getPageCount()).toBe(1);
    const named = await composeChangeDocument({ ...change, letterhead: { name: "Studio Interiors LLC", lines: ["TRN 100123456700003"], footer: null, header: null, logo: null } });
    expect((await PDFDocument.load(named)).getPageCount()).toBe(1);
  });
});
