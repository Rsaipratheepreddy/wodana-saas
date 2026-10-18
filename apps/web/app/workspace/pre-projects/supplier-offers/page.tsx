import { redirect } from "next/navigation";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { SupplierOfferPage } from "@/components/workspace/supplier-offer-page";
import { NoAccessState } from "@/design-system";
import { serverTranslator } from "@/lib/i18n/server";
import { canOpen } from "@/lib/workspace/access";

export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership?.workspaceId) redirect("/login");
  if (Array.isArray(membership.allowedPermissions) && !canOpen("pre-project-supplier-offers", { permissions: membership.allowedPermissions, roles: membership.roles })) {
    return <NoAccessState area={(await serverTranslator())("Supplier offers")} />;
  }
  return <SupplierOfferPage workspaceId={membership.workspaceId} />;
}
