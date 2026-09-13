import {commercialRead} from '@/lib/commercial/server';
import type {QuotationTemplate} from '@/lib/commercial/types';
import {QuotationTemplatesPage} from '@/components/commercial/quotation-templates-page';

export default async function Page() {
  let items: QuotationTemplate[] = [], error = '';
  try { items = (await commercialRead<{items:QuotationTemplate[]}>('quotation-templates')).items; }
  catch (e) { error = e instanceof Error ? e.message : 'Quotation templates could not be loaded.'; }
  return <QuotationTemplatesPage items={items} error={error}/>;
}
