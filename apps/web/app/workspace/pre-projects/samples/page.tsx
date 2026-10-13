import { redirect } from "next/navigation";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { SampleLibraryPage } from "@/components/finishes/sample-library-page";
import { NoAccessState } from "@/design-system";
import { serverTranslator } from "@/lib/i18n/server";
import { canOpen } from "@/lib/workspace/access";

/** PLM-157: the sample library (the samples in stock, by price band), kept by the Material Coordinator. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership?.workspaceId) redirect("/login");
  if (Array.isArray(membership.allowedPermissions) && !canOpen("pre-project-samples", { permissions: membership.allowedPermissions, roles: membership.roles })) {
    return <NoAccessState area={(await serverTranslator())("Sample library")} />;
  }
  return <SampleLibraryPage workspaceId={membership.workspaceId} />;
}
