'use client';
import { useT } from "@/lib/i18n/i18n-provider";
import type { Quote } from '@/lib/commercial/types';
import { quoteTotals } from '@/lib/commercial/client';
import { PaymentMilestonesEditor } from './payment-milestones-editor';

/** The quotation's payment milestones: title, when it's due, its share, and what it must be paid before. */
export function QuotationPaymentEditor({ quote, onChange, readOnly }: { quote: Quote; onChange: (quote: Quote) => void; readOnly: boolean }) {
  const t = useT();
  return <PaymentMilestonesEditor
    ariaLabel={t("Payment milestones")}
    currency={quote.currency}
    milestones={quote.paymentTerms}
    onChange={(paymentTerms) => onChange({ ...quote, paymentTerms })}
    readOnly={readOnly}
    total={quoteTotals(quote).total}
  />;
}
