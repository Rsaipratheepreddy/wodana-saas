import { CatalogSettingsPage } from "@/components/workspace/catalog-settings-page";
import { CatalogCollectionIndex } from "@/components/workspace/catalog-collection-index";
import { getCatalogPageData } from "@/lib/workspace/catalog.server";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ view?: string; catalogId?: string }> }) {
  const { view, catalogId } = await searchParams;
  const data = await getCatalogPageData();
  if (!view && !catalogId) return <CatalogCollectionIndex initialData={data} />;
  const initialView = view === "materials" ? "products" : view === "items" ? "work" : "room";
  return <CatalogSettingsPage key={`${data.workspaceId}:${catalogId ?? ''}:${initialView}`} initialData={data} initialCatalogId={catalogId} initialView={initialView} />;
}
