import { notFound, redirect } from "next/navigation";
import { WorkspaceRegionProvider } from "@/design-system";
import { MovePrint } from "@/components/inventory/move-print";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getWorkspaceRegion } from "@/lib/workspace/region.server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A stock move to print and send with the goods, with the code that opens its receive screen (D-46). */
export default async function Page({ params }: { params: Promise<{ moveId: string }> }) {
  const { moveId } = await params;
  if (!UUID.test(moveId)) notFound();
  const membership = (await getAuthenticatedProfile()).memberships[0];
  if (!membership) redirect("/login");
  return <WorkspaceRegionProvider {...await getWorkspaceRegion(membership.workspaceId, membership)}>
    <MovePrint workspaceId={membership.workspaceId} moveId={moveId} />
  </WorkspaceRegionProvider>;
}
