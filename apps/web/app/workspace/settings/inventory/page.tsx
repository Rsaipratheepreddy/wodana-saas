import { redirect } from "next/navigation";
import { StockPlacesSettings } from "@/components/inventory/stock-places";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Stock places: the warehouses, factory and other places stock is kept. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <StockPlacesSettings workspaceId={membership.workspaceId} />;
}
