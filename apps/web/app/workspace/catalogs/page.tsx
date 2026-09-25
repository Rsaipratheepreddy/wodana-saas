import { CatalogPage } from "@/components/catalog/catalog-page";
import { Callout } from "@/design-system";
import { getCatalogsPageData } from "@/lib/workspace/catalog-v2.server";

export default async function CatalogsPage() {
  const data = await getCatalogsPageData();
  if (data.error) return <Callout title="Catalog unavailable" tone="danger">{data.error}</Callout>;
  return <CatalogPage canManage={data.canManage} canReview={data.canReview} currency={data.currency} initialCatalogs={data.catalogs} locale={data.locale} workspaceId={data.workspaceId} />;
}
