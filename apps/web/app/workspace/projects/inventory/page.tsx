import { GlobalSupplyPage } from '@/components/projects/global-supply-page';
import { getAuthenticatedProfile } from '@/lib/auth/server';
import { projectRead } from '@/lib/projects/server';
import type { SupplyQueuePage } from '../../../../../../services/business-core/src/projects/project-supply-queue';

export default async function InventoryPage() {
  const profile = await getAuthenticatedProfile();
  let data: SupplyQueuePage = { rows: [], stock: [], canBuy: false, canViewInventory: false };
  let error = '';
  try { data = (await projectRead<SupplyQueuePage>('supply-queue')).data; }
  catch { error = 'Inventory could not be loaded. Check your access and retry.'; }
  return <GlobalSupplyPage workspaceId={profile.memberships[0]?.workspaceId ?? ''} initial={data} initialError={error} mode="inventory"/>;
}
