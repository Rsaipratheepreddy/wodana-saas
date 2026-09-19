import {commercialRead} from '@/lib/commercial/server';
import type {QuotationTemplate} from '@/lib/commercial/types';
import {QuotationTemplatesPage} from '@/components/commercial/quotation-templates-page';
import {getAuthenticatedProfile} from '@/lib/auth/server';
import {redirect} from 'next/navigation';

export default async function Page() {
  const profile=await getAuthenticatedProfile();
  const workspaceId=profile.memberships[0]?.workspaceId;
  if(!workspaceId) redirect('/login');
  let items: QuotationTemplate[] = [], error = '';
  try { items = (await commercialRead<{items:QuotationTemplate[]}>('quotation-templates')).items; }
  catch (e) { error = e instanceof Error ? e.message : 'Quotation templates could not be loaded.'; }
  return <QuotationTemplatesPage workspaceId={workspaceId} items={items} error={error}/>;
}
