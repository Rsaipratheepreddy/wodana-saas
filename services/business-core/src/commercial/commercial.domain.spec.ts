import { describe, it, expect } from "vitest";
import {
  actionable,
  acceptedQuoteLines,
  acceptedQuoteTotals,
  acceptedQuoteValue,
  assertQuoteSnapshot,
  clientChangeRequest,
  clientQuote,
  date,
  defaultBrand,
  editable,
  emptyCommercial,
  freezeHash,
  newRequest,
  parseBrand,
  parseCover,
  parseLines,
  parsePaymentTerms,
  phone,
  quoteDecisionEvidence,
  totals,
} from "./commercial.domain";
import type { Quote } from "./commercial.types";
const quote = (): Quote => ({
  id: "q1",
  number: 1,
  kind: "quotation",
  status: "issued",
  title: "Test",
  currency: "AED",
  validUntil: "2099-01-01",
  discount: 10,
  taxRate: 5,
  terms: "Terms",
  exclusions: "Excluded",
  lines: [
    {
      id: "l1",
      room: "Room",
      title: "Item",
      specification: "Specification",
      material: "Material",
      finish: "Finish",
      quantity: 3,
      unit: "nos",
      unitCost: 15,
      rate: 20.15,
      catalogLinks: [
        {
          role: "material",
          recordId: "secret-ref",
          version: 1,
          snapshot: {
            id: "secret-ref",
            code: "C",
            name: "Material",
            kind: "material",
            version: 1,
            catalogId: "catalog",
          },
        },
      ],
    },
  ],
  paymentTerms: [
    {
      id: "m",
      title: "Advance",
      percent: 100,
      trigger: "On acceptance",
      requiredForRelease: true,
    },
  ],
  requestIds: ["internal-id"],
  createdAt: "2026-09-07",
  total: 52.97,
  approvedBy: "Internal approver",
  approverId: "client",
});
describe("Commercial boundaries", () => {
  it("projects structured client requests without internal access identifiers", () => {
    const data = emptyCommercial();
    const request = newRequest(data, "Choose finish", "Select one finish", "q1", {
      ownerMembershipId: "secret-owner-membership",
      clientApproverGrantId: "secret-client-grant",
      target: { type: "quotation", id: "q1", revision: 3, label: "Quotation V3" },
      allowedChoices: [
        { id: "choice-1", label: "Approve" },
        { id: "choice-2", label: "Request changes" },
      ],
      escalationMinutes: 60,
      notificationPolicy: { remindersEnabled: true, channels: ["in_app"] },
      decision: {
        responseId: "response-1",
        choiceId: "choice-1",
        choiceLabel: "Approve",
        note: "Proceed",
        decidedAt: "2026-09-18T10:00:00.000Z",
        decidedBy: "Client approver",
        clientGrantId: "secret-client-grant",
      },
    });
    request.comments.push(
      { id: "client-comment", author: "Client", at: "2026-09-18T09:00:00.000Z", text: "Visible", visibility: "client" },
      { id: "internal-comment", author: "Team", at: "2026-09-18T09:01:00.000Z", text: "Private", visibility: "internal" },
    );

    const projected = clientChangeRequest(request);
    expect(projected.decisionRequest?.target).toEqual({ type: "quotation", id: "q1", revision: 3, label: "Quotation V3" });
    expect(projected.comments.map((comment) => comment.id)).toEqual(["client-comment"]);
    expect(JSON.stringify(projected)).not.toContain("secret-owner-membership");
    expect(JSON.stringify(projected)).not.toContain("secret-client-grant");
    expect(projected).not.toHaveProperty("control");
  });
  it("rounds line totals, discount and tax consistently", () => {
    expect(totals(quote())).toMatchObject({
      subtotal: 60.45,
      net: 50.45,
      tax: 2.52,
      total: 52.97,
      cost: 45,
    });
  });
  it("prices alternatives without adding them to the base quotation total", () => {
    const source = quote();
    source.lines.push({ ...source.lines[0], id: "optional", title: "Upgrade", optional: true, rate: 100 });
    expect(totals(source)).toMatchObject({ subtotal: 60.45, cost: 45, total: 52.97 });
    const parsed = parseLines(source.lines);
    expect(parsed[1].optional).toBe(true);
    expect(clientQuote({ ...source, total: 52.97 }, "client").lines[1].optional).toBe(true);
  });
  it("rejects negative, duplicate and invalid amounts", () => {
    expect(() => parseLines([{ ...quote().lines[0], rate: -1 }])).toThrow();
    expect(() => parseLines([quote().lines[0], quote().lines[0]])).toThrow();
    expect(() => totals({ ...quote(), discount: 61 })).toThrow();
  });
  it("requires a complete 100 percent payment schedule", () => {
    expect(() => parsePaymentTerms([], true)).toThrow();
    expect(() =>
      parsePaymentTerms([{ ...quote().paymentTerms[0], percent: 90 }], true),
    ).toThrow();
    expect(() =>
      parsePaymentTerms(
        [{ ...quote().paymentTerms[0], requiredForRelease: false }],
        true,
      ),
    ).toThrow(/required before project release/);
    expect(parsePaymentTerms(quote().paymentTerms, true)).toHaveLength(1);
  });
  it("uses complete international phone numbers", () => {
    expect(phone("+971 50 123 4567")).toBe("+971501234567");
    expect(() => phone("501234567")).toThrow();
    expect(phone("+91501234567")).not.toBe(phone("+971501234567"));
  });
  it("does not expose internal costs or catalog snapshots in client projections", () => {
    const source = quote();
    source.lines[0].catalogPrice = {
      status: "resolved",
      source: "manual_override",
      mode: "on_request",
      catalogId: "secret-catalog",
      work: { id: "secret-work", version: 1 },
      quantity: 3,
      currency: "AED",
      pricingDate: "2026-09-15",
      taxRate: 5,
      resolvedAt: "2026-09-15T00:00:00.000Z",
      override: {
        amount: 20.15,
        reason: "private commercial reason",
        by: "Internal approver",
        at: "2026-09-15T00:00:00.000Z",
      },
    };
    source.lines[0].manualReason = "internal authorization note";
    const q = clientQuote(source, "client");
    const json = JSON.stringify(q);
    expect(json).not.toContain("unitCost");
    expect(json).not.toContain("catalogLinks");
    expect(json).not.toContain("secret-ref");
    expect(json).not.toContain("Internal approver");
    expect(json).not.toContain("requestIds");
    expect(json).not.toContain("catalogPrice");
    expect(json).not.toContain("internal authorization note");
    expect(q.canDecide).toBe(true);
    expect(clientQuote(quote(), "viewer").canDecide).toBe(false);
  });
  it("accepts only explicit, versioned catalog pricing commands", () => {
    const parsed = parseLines([
      {
        ...quote().lines[0],
        catalogPriceRequest: {
          action: "resolve",
          pricingDate: "2026-09-15",
          rateZoneId: "zone",
          rateZoneVersion: 2,
        },
      },
    ]);
    expect(parsed[0].catalogPriceRequest).toEqual({
      action: "resolve",
      pricingDate: "2026-09-15",
      rateZoneId: "zone",
      rateZoneVersion: 2,
    });
    expect(() =>
      parseLines([
        {
          ...quote().lines[0],
          catalogPriceRequest: { action: "override", reason: "" },
        },
      ]),
    ).toThrow(/Explain why/);
    expect(() =>
      parseLines([
        {
          ...quote().lines[0],
          catalogPriceRequest: { action: "resolve", rateZoneId: "zone" },
        },
      ]),
    ).toThrow(/current version/);
  });
  it("blocks editing issued versions and acting on expired versions", () => {
    expect(() => editable(quote())).toThrow();
    expect(() =>
      actionable({ ...quote(), validUntil: "2020-01-01" }),
    ).toThrow();
    expect(() => actionable({ ...quote(), status: "accepted" })).toThrow();
  });
  it("binds the snapshot hash to the payment schedule and materials", () => {
    const q = quote();
    const hash = freezeHash(q);
    expect(
      freezeHash({
        ...q,
        paymentTerms: [{ ...q.paymentTerms[0], trigger: "Before delivery" }],
      }),
    ).not.toBe(hash);
    expect(
      freezeHash({ ...q, lines: [{ ...q.lines[0], material: "Changed" }] }),
    ).not.toBe(hash);
  });
  it("records acceptance against the issued hash and selected options", () => {
    const q = quote();
    q.lines.push({ ...q.lines[0], id: "upgrade", title: "Premium finish", optional: true, rate: 100 });
    q.hash = freezeHash(q);
    const evidence = quoteDecisionEvidence(
      q,
      "accept",
      ["upgrade"],
      "Client approver",
      "2026-09-18T10:00:00.000Z",
    );
    expect(evidence).toEqual({
      decision: "accept",
      quoteHash: q.hash,
      selectedOptionLineIds: ["upgrade"],
      baseTotal: 52.97,
      optionsTotal: 315,
      acceptedTotal: 367.97,
      decidedAt: "2026-09-18T10:00:00.000Z",
      decidedBy: "Client approver",
    });
    q.clientDecision = evidence;
    expect(acceptedQuoteLines(q).map((line) => line.id)).toEqual(["l1", "upgrade"]);
    expect(acceptedQuoteTotals(q).total).toBe(367.97);
    expect(acceptedQuoteValue(q)).toBe(367.97);
    expect(() => quoteDecisionEvidence(q, "accept", ["missing"], "Client", "2026-09-18T10:00:00.000Z")).toThrow(/this quotation version/i);
    expect(() => quoteDecisionEvidence(q, "changes", ["upgrade"], "Client", "2026-09-18T10:00:00.000Z", "Please revise")).toThrow(/only be selected/i);
  });
  it("rejects a changed issued snapshot and exposes expiry without exposing decisions", () => {
    const q = quote();
    q.hash = freezeHash(q);
    expect(assertQuoteSnapshot(q)).toBe(q.hash);
    q.terms = "Changed after issue";
    expect(() => assertQuoteSnapshot(q)).toThrow(/issued snapshot/i);
    const expired = { ...quote(), validUntil: "2020-01-01" };
    expect(clientQuote(expired, "client")).toMatchObject({ expired: true, canDecide: false });
  });
  it("freezes cover and inclusions and preserves them in the client document", () => {
    const q = {
      ...quote(),
      cover: parseCover({
        preparedFor: "Client A",
        location: "Dubai",
        subtitle: "Proposal",
      }),
      inclusions: "Delivery and installation",
      decisionChallengeId: "private-challenge",
    };
    expect(clientQuote(q, "client").cover).toEqual(q.cover);
    expect(JSON.stringify(clientQuote(q, "client"))).not.toContain(
      "private-challenge",
    );
    expect(
      freezeHash({ ...q, cover: { ...q.cover, location: "Changed" } }),
    ).not.toBe(freezeHash(q));
    expect(freezeHash({ ...q, inclusions: "Changed" })).not.toBe(freezeHash(q));
    expect(() =>
      parseCover({ preparedFor: "x".repeat(161), location: "", subtitle: "" }),
    ).toThrow();
  });
  it("preserves quotation branding, tax and signature in its frozen client document", () => {
    const image = 'data:image/png;base64,aGVsbG8=';
    const cover = parseCover({preparedFor:'Client',location:'Dubai',subtitle:'Proposal',logo:image,banner:image,signature:image,signerName:'Designer',signerTitle:'Director',clientSignature:true,taxLabel:'GST',taxRegistration:'TEST-123'});
    const q = {...quote(),cover};
    expect(clientQuote(q,'client').cover).toEqual(cover);
    expect(freezeHash({...q,cover:{...cover,signerName:'Changed'}})).not.toBe(freezeHash(q));
    for (const key of ['logo','banner','signature']) {
      expect(()=>parseCover({...cover,[key]:'https://example.com/image.png'})).toThrow();
      expect(()=>parseCover({...cover,[key]:'data:image/svg+xml;base64,aGVsbG8='})).toThrow();
      expect(()=>parseCover({...cover,[key]:'x'.repeat(300001)})).toThrow();
    }
  });
  it("validates dates and safe image formats", () => {
    expect(() => date("2026-02-30")).toThrow();
    expect(() =>
      parseBrand({ ...defaultBrand("Test"), logo: "javascript:alert(1)" }),
    ).toThrow();
    expect(() =>
      parseBrand({ ...defaultBrand("Test"), primaryColor: "red;url(x)" }),
    ).toThrow();
  });
});

describe("quotation-only custom materials", () => {
  it("validates structured materials, exposes their specification to the client and locks it into the acceptance hash", () => {
    const q = quote();
    q.lines[0].customMaterials = [{ id: "custom-1", name: "Client marble", code: "MR-20", brand: "Client selection", specification: "20 mm polished slab", suppliedByClient: true }];
    expect(parseLines(q.lines)[0].customMaterials).toEqual(q.lines[0].customMaterials);
    const client = clientQuote(q, "viewer");
    expect(client.lines[0].customMaterials).toEqual(q.lines[0].customMaterials);
    expect(client.lines[0]).not.toHaveProperty("unitCost");
    const before = freezeHash(q);
    q.lines[0].customMaterials[0].specification = "30 mm polished slab";
    expect(freezeHash(q)).not.toEqual(before);
  });
  it("rejects missing names, duplicate IDs and excessive custom products", () => {
    const q = quote(), m = { id: "one", name: "Stone", code: "", brand: "", specification: "", suppliedByClient: false };
    q.lines[0].customMaterials = [{ ...m, name: " " }]; expect(() => parseLines(q.lines)).toThrow();
    q.lines[0].customMaterials = [m, m]; expect(() => parseLines(q.lines)).toThrow(/Duplicate/);
    q.lines[0].customMaterials = Array.from({length:21}, (_,i) => ({ ...m, id:String(i) })); expect(() => parseLines(q.lines)).toThrow(/20/);
  });

  it("matches an approved snapshot after a reload that reorders keys, and still accepts older hashes", async () => {
    const { createHash } = await import("node:crypto");
    const q = quote();
    q.hash = freezeHash(q);
    // Rows rebuild objects with a different key order; the client approved the same content.
    const reloaded = JSON.parse(JSON.stringify(q), (_key, value) => value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value) as Quote;
    expect(assertQuoteSnapshot(reloaded)).toBe(q.hash);
    // A quote issued with the earlier insertion-order hash keeps working.
    const legacy = quote();
    legacy.hash = createHash("sha256").update(JSON.stringify({
      round: legacy.round, direction: legacy.direction, familyId: legacy.familyId, definitionBaseline: legacy.definitionBaseline,
      designEvidence: legacy.designEvidence, title: legacy.title, cover: legacy.cover, presentation: legacy.presentation, rooms: legacy.rooms,
      inclusions: legacy.inclusions, currency: legacy.currency, lines: legacy.lines.map(({ unitCost: _u, manualReason: _m, ...line }) => line),
      discount: legacy.discount, taxRate: legacy.taxRate, terms: legacy.terms, exclusions: legacy.exclusions, validUntil: legacy.validUntil,
      total: legacy.total, brand: legacy.brand, paymentTerms: legacy.paymentTerms, paymentTemplate: legacy.paymentTemplate,
    })).digest("hex");
    expect(assertQuoteSnapshot(legacy)).toBe(legacy.hash);
    // Real content changes are still refused.
    expect(() => assertQuoteSnapshot({ ...reloaded, lines: [{ ...reloaded.lines[0], material: "Changed" }] })).toThrow(/no longer matches/);
  });
});
