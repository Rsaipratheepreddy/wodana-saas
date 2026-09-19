"use client";
import { useState } from "react";
import { QuotationStudio } from "../../components/commercial/quotation-studio";
import { DesignSystemProvider } from "../../design-system";
import type { Quote, CommercialState } from "../../lib/commercial/types";
import { quoteTotals } from "../../lib/commercial/client";
export const sheetQuote: Quote = {
  id: "sheet-fixture",
  number: 2,
  kind: "quotation",
  status: "draft",
  title: "Office fit-out proposal",
  currency: "AED",
  validUntil: "2026-10-07",
  createdAt: "2026-09-07",
  discount: 100,
  taxRate: 5,
  terms: "Valid for 30 days. Work starts after the advance payment.",
  exclusions: "Building permits.",
  inclusions: "Supply, delivery and installation.",
  paymentTerms: [
    {
      id: "advance",
      title: "Advance",
      percent: 50,
      trigger: "On confirmation",
      requiredForRelease: true,
    },
    {
      id: "handover",
      title: "Handover",
      percent: 50,
      trigger: "After installation",
      requiredForRelease: false,
    },
  ],
  requestIds: [],
  total: 0,
  cover: {
    preparedFor: "Sample Client",
    location: "Sample site",
    subtitle: "Interior design & fit-out",
  },
  rooms: [
    { id: "r1", name: "Workplace" },
    { id: "r2", name: "Meeting room" },
  ],
  lines: [
    {
      id: "l1",
      room: "Workplace",
      title: "Workstations",
      catalogLinks: [
        {
          role: "work",
          recordId: "workstation-model",
          version: 1,
          snapshot: {
            id: "workstation-model",
            name: "Workstations",
            kind: "work",
            code: "WS",
            version: 1,
            catalogId: "catalog",
          },
        },
      ],
      variant: "Six-person bench",
      specification: "Cable trays and lockable pedestals.",
      quantity: 3,
      unit: "set",
      rate: 1800,
      unitCost: 700,
      material: "",
      finish: "",
      pricingMode: "materials",
      materialRows: [
        {
          id: "m1",
          name: "Plywood",
          type: "material",
          specification: "18 mm laminated board",
          quantity: 10,
          unit: "m²",
          rate: 120,
          suppliedByClient: false,
        },
        {
          id: "m2",
          name: "Hardware",
          type: "material",
          specification: "Soft-close hardware set",
          quantity: 1,
          unit: "set",
          rate: 300,
          suppliedByClient: false,
        },
        {
          id: "m3",
          name: "Installation",
          type: "labour",
          specification: "Per workstation set",
          quantity: 1,
          unit: "job",
          rate: 300,
          suppliedByClient: false,
        },
      ],
    },
    {
      id: "l2",
      room: "Meeting room",
      title: "Acoustic wall treatment",
      variant: "Fabric panels",
      specification: "Acoustic backing with fabric finish.",
      quantity: 12,
      unit: "m²",
      rate: 180,
      unitCost: 90,
      material: "Acoustic backing",
      finish: "Fabric",
    },
  ],
};
export function QuotationSheetFixture() {
  const [quote, setQuote] = useState(sheetQuote),
    [status, setStatus] = useState(""),
    [revision, setRevision] = useState(1),
    [readOnly, setReadOnly] = useState(false);
  const save = async () => {
    localStorage.setItem(
      "quotation-sheet-fixture",
      JSON.stringify({ ...quote, total: quoteTotals(quote).total }),
    );
    setStatus("Fixture saved");
    setRevision((r) => r + 1);
    return true;
  };
  return (
    <DesignSystemProvider>
      <div style={{ padding: "12px 20px", display: "flex", gap: 16 }}>
        <button onClick={save}>Save fixture</button>
        <button
          onClick={() => {
            const saved = localStorage.getItem("quotation-sheet-fixture");
            if (saved) setQuote(JSON.parse(saved));
          }}
        >
          Reopen fixture
        </button>
        <label>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => setReadOnly(e.target.checked)}
          />
          Read-only fixture
        </label>
        <span role="status">{status}</span>
      </div>
      <QuotationStudio
        quote={quote}
        onChange={setQuote}
        readOnly={readOnly}
        workspaceId="test-workspace"
        caseId="test-case"
        costing={false}
        requests={[]}
        customerName="Sample Client"
        state={{ data: { revision, quotes: [quote] }, canOverridePrice: true } as CommercialState}
        onSave={save}
        onImportScope={() => {}}
      />
    </DesignSystemProvider>
  );
}
