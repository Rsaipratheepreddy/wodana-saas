import { notFound, redirect } from "next/navigation";
import { InspectionRecord } from "@/components/factory/inspection-record";
import { getAuthenticatedProfile } from "@/lib/auth/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * PLM-150: one design inspection at the factory, opened by the designer (from My day or its notice), the factory or a
 * manager; who may see and record it is decided by the inspection itself.
 */
export default async function Page({ params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  if (!UUID.test(inspectionId)) notFound();
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <InspectionRecord workspaceId={membership.workspaceId} inspectionId={inspectionId} />;
}
