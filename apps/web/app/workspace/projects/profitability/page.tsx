import { redirect } from "next/navigation";
import { ProjectsProfitability } from "@/components/books/projects-profitability";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Projects › Profitability: every project the person sees the costs of, with its margins and what needs a look. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <ProjectsProfitability workspaceId={membership.workspaceId} />;
}
