/**
 * The browser-printed documents with realistic made-up data, one per `?doc=` (rendered to PDF by render.mjs): the
 * purchase order, the delivery note, the material list, the client's tax invoice and receipt, in English and Arabic.
 */
import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import { PortalDocumentPrint } from "@/components/client-portal/portal-document-print";
import { MovePrint } from "@/components/inventory/move-print";
import { MaterialListPrint } from "@/components/pre-project/material-list-print";
import { OrderPrint } from "@/components/purchasing/order-print";
import { WorkspaceIdentityProvider } from "@/components/workspace/workspace-identity";
import { DesignSystemProvider } from "@/design-system";
import { I18nProvider } from "@/lib/i18n/i18n-provider";
import { workspacePrimaryColorStyle } from "@/lib/workspace/primary-color";

const LOGO = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><rect width="120" height="120" rx="24" fill="#1F5C4F"/><text x="60" y="80" font-family="Helvetica" font-size="64" font-weight="700" fill="#fff" text-anchor="middle">SM</text></svg>')}`;
const letterhead = {
  entityId: "e1", legalName: "Studio Meridian Interiors LLC", taxLabel: "TRN", taxName: "VAT", taxNumber: "100123456700003", licenceNumber: "1234567",
  address: "Office 1204, Bay Square Building 3, Business Bay, Dubai", phone: "+971 4 123 4567", email: "hello@studiomeridian.example",
  footer: "Studio Meridian Interiors LLC · Registered in Dubai · Bank: Example Bank, IBAN AE07 0331 2345 6789 0123 456", logoUrl: LOGO, headerUrl: null,
};
const order = {
  order: { id: "6d0f2b67-6f6a-4a22-8cb0-3f2d5d77a33a", number: "SM-PO-2026-00011", status: "sent", supplierName: "Nile Timber Trading LLC", companyName: "Studio Meridian", currency: "AED",
    deliverTo: "site", deliveryAddress: "Villa 14, Street 7, Arabian Ranches 2, Dubai", createdAt: "2026-10-10T08:00:00.000Z", sentAt: "2026-10-12T08:00:00.000Z", expectedDate: "2026-10-20",
    promisedDate: "2026-10-19", projects: [{ id: "p1", reference: "PRJ-0042" }], supplierReference: "SO-NT-88231", notes: "Call the site supervisor 30 minutes before delivery. Gate pass required.",
    subtotal: "18450.0000", discountTotal: "450.0000", taxTotal: "900.0000", total: "18900.0000", legalEntityId: "e1", paymentTerms: "split", advancePercent: "30.00", creditDays: null,
    retentionPercent: "0", termsNote: "Prices include delivery to site and unloading.", approvedByName: "Olivia Owner" },
  lines: [
    { id: "l1", description: "Oak veneered MDF board, 18 mm, crown cut, A grade", specification: "2440 × 1220 mm, FSC certified", quantity: "40.0000", unit: "sheets", unitPrice: "285.0000", total: "11400.0000", projectReference: "PRJ-0042" },
    { id: "l2", description: "Edge banding, oak, 1 mm", specification: "", quantity: "300.0000", unit: "m", unitPrice: "6.5000", total: "1950.0000", projectReference: "PRJ-0042" },
    { id: "l3", description: "Soft-close concealed hinges (Blum Clip top)", specification: "110°, with damping", quantity: "120.0000", unit: "nos", unitPrice: "42.5000", total: "5100.0000", projectReference: "PRJ-0042" },
  ],
  supplier: { id: "v1", name: "Nile Timber Trading LLC", email: "orders@niletimber.example", phone: "+971 6 555 0101", contactName: "Sara Haddad" },
};
const move = {
  transfer: { id: "7e1f3c78-7a7b-4b33-9dc1-4a3e6e88b44b", number: 27, status: "in_transit", fromName: "Al Quoz warehouse", toName: "PRJ-0042 · Villa 14 site", sentOn: "2026-10-12", sentByName: "Dana Stores",
    note: "Fragile: two marble slabs on A-frame.", projects: [{ id: "p1", reference: "PRJ-0042" }] },
  lines: [
    { id: "t1", itemId: "i1", itemName: "Calacatta marble slab, 20 mm", unit: "nos", projectId: "p1", projectReference: "PRJ-0042", quantity: "2.0000", received: null, lossReason: "" },
    { id: "t2", itemId: "i2", itemName: "Tile adhesive, white, 20 kg", unit: "bags", projectId: "p1", projectReference: "PRJ-0042", quantity: "12.0000", received: null, lossReason: "" },
  ],
  canManage: true, canAdjust: false, canReceive: true, canReceiveThis: true, canCancelThis: false,
};
const version = (id: string, title: string, specification: string, quantity: string, unit: string, unitPrice: string, status: string) => ({
  id: `${id}v`, entryId: id, number: 2, title, specification, catalogItemId: null, supplier: "", quantity, unit, unitPrice, currency: "AED", priceImpact: "0", timeImpactDays: 0,
  source: "showroom", saidAt: "2026-10-01", evidenceAssetId: null, evidenceName: null, evidenceNote: "", note: "", afterLock: false, status, confirmedAt: null, confirmationMethod: null,
  confirmedByName: null, fromPortal: false, recordedByName: "Dana Designer", recordedAt: "2026-10-01T09:00:00Z",
});
const entry = (id: string, room: string, ...rest: Parameters<typeof version>) => ({ id, kind: "material", roomId: room, roomName: room, position: 1, currentNumber: 2, archivedAt: null,
  archivedAfterLock: false, version: 2, title: rest[1], current: version(...rest), locked: null, versions: [] });
const ledger = {
  state: "locked", lockProblem: null, currency: "AED", lock: { number: 1, reason: "", lockedAt: "2026-10-08T10:00:00Z", lockedByName: "Aisha Rahman", note: null },
  entries: [
    entry("m1", "Kitchen", "m1", "Quartz countertop, Calacatta Gold", "20 mm, polished, undermount sink cut-out", "7.40", "rm", "1250.00", "confirmed"),
    entry("m2", "Kitchen", "m2", "Backsplash porcelain tile 600 × 1200", "Matt, rectified", "9.00", "sqm", "180.00", "confirmed"),
    entry("m3", "Master bedroom", "m3", "Engineered oak flooring, herringbone", "15/4 mm, brushed, natural oil", "28.00", "sqm", "260.00", "confirmed"),
    entry("m4", "Master bedroom", "m4", "Wardrobe fronts, walnut veneer", "Book-matched, satin lacquer", "1.00", "set", "9800.00", "proposed"),
  ],
};
const site = { brand: { name: "Studio Meridian", logoUrl: LOGO }, region: { country: "AE", locale: "en-AE", currency: "AED", timeZone: "Asia/Dubai" } };
const invoice = {
  number: "SM-INV-2026-00031", issueDate: "2026-10-12", dueDate: "2026-10-19", currency: "AED", milestone: "Carpentry start (30%)", reference: "SM-QUO-2026-00012",
  company: { name: "Studio Meridian Interiors LLC", address: "Office 1204, Bay Square Building 3, Business Bay, Dubai, AE", taxNumber: "100123456700003" },
  customer: { name: "Aisha Rahman", address: "Villa 14, Street 7, Arabian Ranches 2, Dubai, AE", taxNumber: "" },
  lines: [
    { description: "Villa 14 interior fit-out · 30% stage payment on carpentry start", taxRate: "5", net: "25200.00", tax: "1260.00", total: "26460.00" },
    { description: "Change request CR-007 · study nook (100% before work)", taxRate: "5", net: "4110.00", tax: "205.50", total: "4315.50" },
  ],
  net: "29310.00", tax: "1465.50", total: "30775.50", paid: "10000.00", balance: "20775.50", note: "Please quote the invoice number with your transfer.", status: "due", credit: null, letterhead,
};
const receipt = { id: "r1", milestone: "Advance (40%)", amount: "35280.00", currency: "AED", receivedOn: "2026-10-02", invoiceNumber: "SM-INV-2026-00027", company: "Studio Meridian Interiors LLC",
  customer: "Aisha Rahman", letterhead };

// The documents read their data from the workspace API; here it answers with the fixtures above.
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/letterhead")) return json(letterhead);
  if (url.includes("/api/purchasing/")) return json(order);
  if (url.includes("/api/inventory/")) return json(move);
  if (url.includes("design-ledger")) return json(ledger);
  return realFetch(input, init);
}) as typeof window.fetch;

const doc = new URLSearchParams(window.location.search).get("doc") ?? "order";
const arabic = doc.endsWith("-ar");
const kind = doc.replace(/-ar$/, "");
const view = kind === "order" ? <OrderPrint workspaceId="w" orderId={order.order.id} />
  : kind === "move" ? <MovePrint workspaceId="w" moveId={move.transfer.id} />
    : kind === "materials" ? <MaterialListPrint workspaceId="w" caseId="c" caseTitle="Villa 14 · Aisha Rahman" />
      : kind === "receipt" ? <PortalDocumentPrint site={site as never} document={{ kind: "receipt", receipt: receipt as never }} />
        : <PortalDocumentPrint site={site as never} document={{ kind: "invoice", invoice: (arabic ? { ...invoice, customer: { ...invoice.customer, name: "عائشة الرحمن", address: "فيلا 14، شارع 7، المرابع العربية 2، دبي" } } : invoice) as never }} />;
document.documentElement.dir = arabic ? "rtl" : "ltr";
document.documentElement.lang = arabic ? "ar" : "en";
createRoot(document.getElementById("root")!).render(
  <I18nProvider language={arabic ? "ar" : "en"}>
    <DesignSystemProvider locale="en-AE" currency="AED" timeZone="Asia/Dubai" style={workspacePrimaryColorStyle({ primaryColor: "#1F5C4F" })}>
      <WorkspaceIdentityProvider identity={{ name: "Studio Meridian", logoUrl: LOGO }}>{view}</WorkspaceIdentityProvider>
    </DesignSystemProvider>
  </I18nProvider>,
);
