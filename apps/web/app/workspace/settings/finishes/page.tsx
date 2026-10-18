import { redirect } from "next/navigation";
import { FinishSettings } from "@/components/finishes/finish-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings › Finishes & samples (PLM-146/148/156/157): finish categories, the final-specification gate, the material column's editors and the sample price bands. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <FinishSettings workspaceId={membership.workspaceId} />;
}
