import { describe, expect, it, vi } from "vitest";
import { proofMatch, proofReadingRequest, readPaymentProof, validateProofReading } from "./payment-proof-reading";

describe("payment proof reading (AI proposes, Finance confirms)", () => {
  it("keeps only fields that fit and never invents an amount", () => {
    const reading = validateProofReading({ amount: "12,500.00", currency: "aed", date: "2026-10-03", reference: " TXN-8891 ", payer: "Amira", confidence: "high" }, "2026-10-05T00:00:00.000Z");
    expect(reading).toEqual({ amount: "12500.00", currency: "AED", date: "2026-10-03", reference: "TXN-8891", payer: "Amira", confidence: "high", readAt: "2026-10-05T00:00:00.000Z" });
    const vague = validateProofReading({ amount: "about twelve thousand", currency: "dirhams", date: "3 Oct", confidence: "high" });
    expect(vague).toMatchObject({ amount: null, currency: null, date: null, confidence: "low" });
    expect(() => validateProofReading("nope")).toThrow(/could not be read/);
  });

  it("compares the reading with what people expect, exactly and per currency", () => {
    expect(proofMatch({ amount: "12500.00", currency: "AED" }, { amount: "12500", currency: "AED" })).toBe("match");
    expect(proofMatch({ amount: "12500", currency: "AED" }, { amount: "15000", currency: "AED" })).toBe("mismatch");
    expect(proofMatch({ amount: "12500", currency: "EUR" }, { amount: "12500", currency: "AED" })).toBe("mismatch");
    expect(proofMatch({ amount: null, currency: null }, { amount: "12500", currency: "AED" })).toBe("unknown");
    expect(proofMatch({ amount: "1", currency: "AED" }, null)).toBe("unknown");
  });

  it("sends the proof as an attachment with the firm's currency as context only", () => {
    const request = proofReadingRequest({ mimeType: "image/png", base64: "AAAA" }, { currency: "AED", expectedAmount: "15000" });
    const parts = request.contents[0].parts as Array<Record<string, unknown>>;
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "AAAA" } });
    expect(String(parts[0].text)).toContain("report what the proof shows");
    expect(request.generationConfig.responseMimeType).toBe("application/json");
  });

  it("stores the reading on the proof and falls back to nothing when AI is off or the file is not readable", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const ai = { generate: vi.fn(async () => ({ text: JSON.stringify({ amount: "15000", currency: "AED", date: "2026-10-03", reference: "R1", payer: null, confidence: "high" }), finishReason: "STOP", model: "m", provider: "bedrock" })) };
    const input = { workspaceId: "w", opportunityId: "o", proofId: "p", mimeType: "image/jpeg", body: Buffer.from("x"), currency: "AED", expectedAmount: "15000" };
    const reading = await readPaymentProof(ai as never, { query } as never, {} as never, input);
    expect(reading).toMatchObject({ amount: "15000", currency: "AED", reference: "R1" });
    expect(query.mock.calls[0][0]).toContain("SET reading");
    expect(await readPaymentProof(ai as never, { query } as never, {} as never, { ...input, mimeType: "video/mp4" })).toBeNull();
    const off = { generate: vi.fn(async () => { throw new Error("AI assistance is off"); }) };
    expect(await readPaymentProof(off as never, { query } as never, {} as never, input)).toBeNull();
  });
});
