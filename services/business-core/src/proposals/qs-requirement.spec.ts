import { describe, expect, it } from "vitest";
import { decideQsRequirement, quoteReviewAction, type QsInputs } from "./qs-requirement";

const main = { kind: "quotation", round: "main" };
const base: QsInputs = { qsReview: true, scope: "rules", quote: main, boqRequired: null, workPackages: [], itemTypes: [] };

describe("QS review only where it applies (PLM-082/083/084)", () => {
  it("keeps the firm's switch as the master switch, and keeps variations away from the QS where the firm says so", () => {
    expect(decideQsRequirement({ ...base, qsReview: false, workPackages: ["Joinery"], boqRequired: true })).toEqual({ required: false, reason: { code: "off" } });
    expect(decideQsRequirement({ ...base, quote: { kind: "variation", round: null }, workPackages: ["Joinery"] })).toEqual({ required: false, reason: { code: "not_quotation" } });
    const never = { rule: "never" as const, threshold: "10000", total: "50000" };
    expect(decideQsRequirement({ ...base, quote: { kind: "variation", round: null }, workPackages: ["Joinery"], variation: never })).toEqual({ required: false, reason: { code: "not_quotation" } });
  });

  it("sends a variation to the QS by the same rules: its size, every quotation, or joinery and marked kinds", () => {
    const variation = { kind: "variation", round: null };
    const rules = (total: string, threshold: string | null = "10000") => ({ rule: "rules" as const, threshold, total });
    // A credit counts by its size too.
    expect(decideQsRequirement({ ...base, quote: variation, variation: rules("-10000.00") })).toEqual({ required: true, reason: { code: "variation_amount" } });
    expect(decideQsRequirement({ ...base, quote: variation, variation: rules("9999.99") })).toEqual({ required: false, reason: { code: "standard_only" } });
    expect(decideQsRequirement({ ...base, quote: variation, workPackages: ["Joinery"], variation: rules("800", null) }))
      .toEqual({ required: true, reason: { code: "lines", workPackages: ["Joinery"], itemTypes: [] } });
    expect(decideQsRequirement({ ...base, scope: "all", quote: variation, variation: rules("10", null) })).toEqual({ required: true, reason: { code: "every_quotation" } });
    expect(decideQsRequirement({ ...base, qsReview: false, quote: variation, variation: rules("90000") })).toEqual({ required: false, reason: { code: "off" } });
  });

  it("reviews every quotation when the firm prices everything with the QS, unless the order needs no BOQ (as before)", () => {
    expect(decideQsRequirement({ ...base, scope: "all" })).toEqual({ required: true, reason: { code: "every_quotation" } });
    expect(decideQsRequirement({ ...base, scope: "all", quote: { kind: "quotation", round: "design" } })).toMatchObject({ required: true });
    expect(decideQsRequirement({ ...base, scope: "all", boqRequired: false })).toEqual({ required: false, reason: { code: "no_boq" } });
  });

  it("under the rules: joinery or bespoke lines need the QS and say which", () => {
    expect(decideQsRequirement({ ...base, workPackages: ["Joinery", "Bespoke furniture"] }))
      .toEqual({ required: true, reason: { code: "lines", workPackages: ["Bespoke furniture", "Joinery"], itemTypes: [] } });
    expect(decideQsRequirement({ ...base, itemTypes: ["assembly"] })).toEqual({ required: true, reason: { code: "lines", workPackages: [], itemTypes: ["assembly"] } });
  });

  it("under the rules: a deal whose path needs a BOQ needs the QS even with standard items", () => {
    expect(decideQsRequirement({ ...base, boqRequired: true })).toEqual({ required: true, reason: { code: "boq_required" } });
  });

  it("under the rules: Design Fee proposals and standard-furniture-only quotations skip the QS", () => {
    expect(decideQsRequirement({ ...base, quote: { kind: "quotation", round: "design" }, workPackages: ["Joinery"], boqRequired: true }))
      .toEqual({ required: false, reason: { code: "design_fee" } });
    expect(decideQsRequirement(base)).toEqual({ required: false, reason: { code: "standard_only" } });
    expect(decideQsRequirement({ ...base, boqRequired: false })).toEqual({ required: false, reason: { code: "standard_only" } });
  });

  it("asks the QS once: a quotation the QS confirmed through Send to QS takes the plain approval", async () => {
    const db = (review: string | null) => ({
      query: async (sql: string) => {
        if (sql.includes("workspace_quotation_settings")) return { rows: [{ qsReview: true, scope: "all", itemTypes: [] }] };
        if (sql.includes("FROM commercial_quotes")) return { rows: [{ kind: "quotation", round: "main" }] };
        if (sql.includes("FROM quote_qs_reviews")) return { rows: review ? [{ status: review }] : [] };
        return { rows: [] };
      },
    });
    const quote = { id: "q", kind: "quotation" };
    expect(await quoteReviewAction(db(null) as never, "w", "c", quote, true)).toBe("qs_approve");
    expect(await quoteReviewAction(db("with_qs") as never, "w", "c", quote, true)).toBe("qs_approve");
    expect(await quoteReviewAction(db("returned") as never, "w", "c", quote, true)).toBe("qs_approve");
    expect(await quoteReviewAction(db("confirmed") as never, "w", "c", quote, true)).toBe("approve");
    expect(await quoteReviewAction(db(null) as never, "w", "c", quote, false)).toBe("approve");
  });
});
