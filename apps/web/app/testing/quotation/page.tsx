import { notFound } from 'next/navigation';
import { QuotationSheetFixture } from '../../../e2e/fixtures/quotation-sheet';

/** Isolated browser fixture: never available in production or without E2E mode. */
export default function Page() {
  if (process.env.NODE_ENV === 'production' || process.env.E2E_AUTH_BYPASS !== 'true') notFound();
  return <QuotationSheetFixture/>;
}
