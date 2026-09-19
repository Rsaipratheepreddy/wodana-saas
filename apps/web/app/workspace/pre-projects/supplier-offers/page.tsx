import { redirect } from "next/navigation";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { SupplierOfferPage } from "@/components/workspace/supplier-offer-page";

export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const workspaceId = profile.memberships[0]?.workspaceId;
  if (!workspaceId) redirect("/login");
  return <SupplierOfferPage workspaceId={workspaceId} />;
}
