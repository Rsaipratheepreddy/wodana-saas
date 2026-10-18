import { notFound, redirect } from "next/navigation";
import { WorkspaceRegionProvider } from "@/design-system";
import { MaterialListPrint } from "@/components/pre-project/material-list-print";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getWorkspaceRegion } from "@/lib/workspace/region.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** PLM-050: the material list produced from the materials and decisions ledger, to print or save as PDF. */
export default async function Page({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  if (!UUID.test(caseId)) notFound();
  const membership = (await getAuthenticatedProfile()).memberships[0];
  if (!membership) redirect("/login");
  return <WorkspaceRegionProvider {...await getWorkspaceRegion(membership.workspaceId, membership)}>
    <MaterialListPrint workspaceId={membership.workspaceId} caseId={caseId} />
  </WorkspaceRegionProvider>;
}
