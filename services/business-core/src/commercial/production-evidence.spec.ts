import { describe, expect, it } from "vitest";
import { emptyCommercial, freezeHash } from "./commercial.domain";
import {
  approvedMaterialEvidence,
  agreementMatchesAcceptedQuote,
  materialApprovalsComplete,
  materialListSignedOff,
  sameMaterialEvidence,
} from "./release-integrity";
import type { MaterialApproval, Quote } from "./commercial.types";

const quote = (): Quote => ({
  id: "quote",
  number: 1,
  kind: "quotation",
  status: "accepted",
  title: "Joinery",
  currency: "AED",
  validUntil: "2026-10-01",
  discount: 0,
  taxRate: 5,
  terms: "Terms",
  exclusions: "",
  requestIds: [],
  paymentTerms: [],
  createdAt: "2026-09-18T00:00:00.000Z",
  total: 105,
  lines: [{
    id: "line",
    room: "Bedroom",
    title: "Wardrobe",
    specification: "Oak veneer",
    material: "Oak veneer",
    finish: "Matte",
    quantity: 1,
    unit: "nos",
    unitCost: 60,
    rate: 100,
    materialRows: [{
      id: "veneer",
      name: "Oak veneer",
      type: "material",
      specification: "Quarter-cut",
      quantity: 1,
      unit: "nos",
      rate: 100,
      suppliedByClient: false,
    }],
  }],
});

const approval = (): MaterialApproval => ({
  id: "approval",
  quoteId: "quote",
  lineId: "line",
  materialRowId: "veneer",
  revision: 2,
  room: "Bedroom",
  item: "Wardrobe",
  name: "Oak veneer",
  code: "OV-01",
  brand: "Mill",
  specification: "Quarter-cut",
  note: "Approved sample",
  status: "approved",
  approverId: "client",
  decisionChallengeId: "secret",
  decidedAt: "2026-09-18T09:00:00.000Z",
  decidedBy: "Client",
});

describe("commercial production evidence", () => {
  it("freezes exact approved material revisions without carrying challenge identity into equality", () => {
    const evidence = approvedMaterialEvidence(quote(), [approval()]);
    expect(evidence).toMatchObject([{ materialRowId: "veneer", revision: 2 }]);
    expect(sameMaterialEvidence(evidence, [{ ...approval(), decisionChallengeId: "rotated" }])).toBe(true);
    expect(sameMaterialEvidence(evidence, [{ ...approval(), revision: 3 }])).toBe(false);
  });

  it("includes approved design evidence in the accepted quotation hash", () => {
    const base = quote();
    const withEvidence: Quote = {
      ...base,
      designEvidence: {
        capturedAt: "2026-09-18T08:00:00.000Z",
        links: [],
      },
    };
    expect(freezeHash(withEvidence)).not.toBe(freezeHash(base));
  });

  it("requires material approval only for options included in the acceptance", () => {
    const base = quote();
    const optional = {
      ...base.lines[0],
      id: "optional-line",
      optional: true,
      materialRows: [{ ...base.lines[0].materialRows![0], id: "optional-material", name: "Premium veneer" }],
    };
    const withoutOption = { ...base, lines: [...base.lines, optional] };
    expect(approvedMaterialEvidence(withoutOption, [approval()])).toHaveLength(1);
    const withOption = {
      ...withoutOption,
      clientDecision: {
        decision: "accept" as const,
        quoteHash: "hash",
        selectedOptionLineIds: ["optional-line"],
        baseTotal: 105,
        optionsTotal: 105,
        acceptedTotal: 210,
        decidedAt: "2026-09-18T09:00:00.000Z",
        decidedBy: "Client",
      },
    };
    expect(approvedMaterialEvidence(withOption, [approval()])).toHaveLength(1);
    expect(materialApprovalsComplete(withoutOption, [approval()])).toBe(true);
    expect(materialApprovalsComplete(withOption, [approval()])).toBe(false);
  });

  it("uses the accepted quote without inventing a separate material meeting on ready-made routes", () => {
    const accepted = quote();
    expect(materialApprovalsComplete(accepted, [])).toBe(false);
    const data = emptyCommercial();
    data.servicePath = { scope: {
        design: false, mainQuotation: true, materialSelection: false, procurement: true,
        manufacturing: false, siteWorks: false, installation: true,
      }, selectedAt: "2026-09-25T00:00:00Z", selectedBy: "Sales" };
    expect(materialListSignedOff(data, accepted)).toBe(true);
    data.servicePath.scope.materialSelection = true;
    expect(materialListSignedOff(data, accepted)).toBe(false);
    data.materialApprovals = [approval()];
    expect(materialListSignedOff(data, accepted)).toBe(true);
  });

  it("binds agreement evidence to the exact accepted revision and selection", () => {
    const accepted = quote();
    accepted.hash = freezeHash(accepted);
    accepted.clientDecision = {
      decision: "accept",
      quoteHash: accepted.hash,
      selectedOptionLineIds: [],
      baseTotal: 105,
      optionsTotal: 0,
      acceptedTotal: 105,
      decidedAt: "2026-09-18T09:00:00.000Z",
      decidedBy: "Client",
    };
    const agreement = {
      quoteId: accepted.id,
      quoteHash: accepted.hash,
      selectedOptionLineIds: [],
      acceptedTotal: 105,
      reference: "AGR-1",
      terms: "Terms",
      evidence: "Signed document 1",
      status: "executed" as const,
    };
    expect(agreementMatchesAcceptedQuote(agreement, accepted)).toBe(true);
    expect(agreementMatchesAcceptedQuote({ ...agreement, acceptedTotal: 100 }, accepted)).toBe(false);
  });
});
