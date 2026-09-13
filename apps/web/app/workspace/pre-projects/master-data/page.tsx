import { CatalogSettingsPage } from "@/components/workspace/catalog-settings-page";
import { getCatalogPageData } from "@/lib/workspace/catalog.server";

export default async function MasterDataPage() {
  const data = await getCatalogPageData();
  return <CatalogSettingsPage key={data.workspaceId} initialData={data} />;
}
