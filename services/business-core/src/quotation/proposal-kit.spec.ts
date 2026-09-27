import { describe, expect, it } from "vitest";
import { auditableKit, changeProposalKit, EMPTY_PROPOSAL_KIT } from "./proposal-kit";

const pixel = "data:image/png;base64,iVBORw0KGgo=";

describe("proposal kit", () => {
  it("applies a partial change and trims words", () => {
    const next = changeProposalKit(EMPTY_PROPOSAL_KIT, { introduction: "  About us \r\n", website: "https://studio.test" });
    expect(next).toMatchObject({ introduction: "About us", website: "https://studio.test", defaultTerms: "" });
  });
  it("clears a field with null and ignores unknown keys", () => {
    const next = changeProposalKit({ ...EMPTY_PROPOSAL_KIT, closingImage: pixel }, { closingImage: null, colour: "#fff" });
    expect(next.closingImage).toBeNull();
    expect(next).not.toHaveProperty("colour");
  });
  it("rejects outside pictures, oversized pictures and too many terms pictures", () => {
    expect(() => changeProposalKit(EMPTY_PROPOSAL_KIT, { closingImage: "https://example.com/a.png" })).toThrow(/PNG, JPEG or WebP/);
    expect(() => changeProposalKit(EMPTY_PROPOSAL_KIT, { closingImage: `data:image/png;base64,${"A".repeat(400_001)}` })).toThrow(/too large/);
    expect(() => changeProposalKit(EMPTY_PROPOSAL_KIT, { termsImages: [pixel, pixel, pixel, pixel] })).toThrow(/up to three/);
  });
  it("caps the pictures together", () => {
    const big = `data:image/png;base64,${"A".repeat(350_000)}`;
    expect(() => changeProposalKit(EMPTY_PROPOSAL_KIT, { introductionImage: big, closingImage: big, monogramImage: big, termsImages: [big] })).toThrow(/together/);
  });
  it("rejects long words and malformed websites", () => {
    expect(() => changeProposalKit(EMPTY_PROPOSAL_KIT, { letterNote: "x".repeat(1001) })).toThrow(/too long/);
    expect(() => changeProposalKit(EMPTY_PROPOSAL_KIT, { website: "javascript:alert(1)" })).toThrow(/website/i);
    expect(() => changeProposalKit(EMPTY_PROPOSAL_KIT, { introduction: 42 })).toThrow(/text/);
  });
  it("keeps only picture sizes in the audit log", () => {
    const audit = auditableKit({ ...EMPTY_PROPOSAL_KIT, closingImage: pixel, termsImages: [pixel] });
    expect(audit.closingImage).toBe(pixel.length);
    expect(audit.termsImages).toEqual([pixel.length]);
  });
});
