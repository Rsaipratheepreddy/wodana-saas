import { notFound, redirect } from "next/navigation";
import { InventoryPage } from "@/components/inventory/inventory-page";
import { INVENTORY_SECTIONS, type InventorySection } from "@/lib/inventory/sections";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Inventory: Stock (default), Moves and History. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const requested = section?.[0] ?? "stock";
  if ((section?.length ?? 0) > 1 || !INVENTORY_SECTIONS.includes(requested as InventorySection)) notFound();
  return <InventoryPage workspaceId={membership.workspaceId} section={requested as InventorySection} />;
}
