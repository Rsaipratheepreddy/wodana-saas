import { notFound, redirect } from "next/navigation";
import { HrmsPage } from "@/components/hrms/hrms-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { HRMS_SECTIONS, MOVED_HRMS_PATHS, type HrmsSection } from "@/lib/hrms/sections";

/** People: my attendance (the default), my leave, my team and everyone's HR record. Old addresses go where they live now. */
export default async function Page({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params;
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  if ((section?.length ?? 0) > 1) notFound();
  const requested = section?.[0];
  if (requested && MOVED_HRMS_PATHS[requested]) redirect(MOVED_HRMS_PATHS[requested]);
  const current = requested ?? "attendance";
  if (!HRMS_SECTIONS.includes(current as HrmsSection)) notFound();
  return <HrmsPage workspaceId={membership.workspaceId} section={current as HrmsSection} />;
}
