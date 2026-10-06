import { describe, expect, it } from "vitest";
import { defaultDocument, parseDocument } from "./quote-document";

describe("quote document", () => {
  it("PLM-045: keeps a revision's note on what changed, trimmed and bounded, without touching the rest", () => {
    const current = defaultDocument({ terms: "Net 30" });
    expect(current.changeNote).toBe("");
    const next = parseDocument({ changeNote: "  Value engineering: porcelain instead of marble in the guest bath.  " }, current);
    expect(next.changeNote).toBe("Value engineering: porcelain instead of marble in the guest bath.");
    expect(next.terms).toBe("Net 30");
    expect(parseDocument({ title: "Villa 12" }, next).changeNote).toBe(next.changeNote);
    expect(() => parseDocument({ changeNote: "x".repeat(2001) }, current)).toThrow(/under 2000/);
    expect(() => parseDocument({ changeNote: 5 }, current)).toThrow(/must be text/);
  });
});
