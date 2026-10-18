import { redirect } from "next/navigation";
import { ApprovalPoliciesPage } from "@/components/approvals/approval-policies";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Approvals (E3): who approves what, from which amount, in which order; and who covers whom while away. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <ApprovalPoliciesPage workspaceId={membership.workspaceId} />;
}
