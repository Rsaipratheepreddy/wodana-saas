import { notFound } from "next/navigation";
import { getCommercial } from "@/lib/commercial/server";
import { QuotationPrint } from "@/components/commercial/quotation-print";
import { quotationLineVariant, quotationMaterialText } from "@/lib/commercial/presentation";
import type { ClientQuote } from "@/lib/commercial/types";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ quote?: string; snapshot?: string }>;
}) {
  const { caseId } = await params,
    { quote: id, snapshot } = await searchParams;
  const data = await getCommercial(caseId),
    quote = data.data.quotes.find((q) => q.id === id && q.issuedAt);
  if (!quote || (snapshot && snapshot !== quote.hash)) notFound();
  const safe: ClientQuote = {
    id: quote.id, number: quote.number, kind: quote.kind, direction: quote.direction,
    status: quote.status, title: quote.title, cover: quote.cover, brand: quote.brand,
    currency: quote.currency, validUntil: quote.validUntil, discount: quote.discount,
    taxRate: quote.taxRate, terms: quote.terms, inclusions: quote.inclusions,
    exclusions: quote.exclusions, createdAt: quote.createdAt, issuedAt: quote.issuedAt,
    decidedAt: quote.decidedAt, decidedBy: quote.decidedBy, total: quote.total,
    clientDecision: quote.clientDecision, hash: quote.hash,
    paymentTerms: quote.paymentTerms, paymentTemplate: quote.paymentTemplate,
    rooms: quote.rooms?.map(({id,name}) => ({id,name})), canDecide: false,
    expired: false,
    lines: quote.lines.map(line => {
      return {
        id: line.id, room: line.room, title: line.title, specification: line.specification,
        material: quotationMaterialText(line, "material"), finish: quotationMaterialText(line, "finish"), customMaterials: line.customMaterials,
        quantity: line.quantity, unit: line.unit, rate: line.rate,
        variantLabel: quotationLineVariant(line),
        variant: line.variant, photo: line.photo,
        materialRows: line.materialRows, pricingMode: line.pricingMode,
        optional: line.optional,
      };
    }),
  };
  return <QuotationPrint quote={safe} customer={data.customerName} />;
}
