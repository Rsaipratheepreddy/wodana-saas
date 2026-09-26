import { notFound, redirect } from "next/navigation";
import { PurchasingPage } from "@/components/purchasing/purchasing-page";
import { PURCHASING_SECTIONS, type PurchasingSection } from "@/lib/purchasing/sections";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Purchasing: To order (default), Orders and Suppliers. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  const requested = section?.[0] ?? "to-order";
  if ((section?.length ?? 0) > 1 || !PURCHASING_SECTIONS.includes(requested as PurchasingSection)) notFound();
  return <PurchasingPage workspaceId={membership.workspaceId} section={requested as PurchasingSection} />;
}
