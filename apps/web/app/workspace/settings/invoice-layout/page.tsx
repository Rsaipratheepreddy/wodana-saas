import { redirect } from "next/navigation";
import { InvoiceLayoutPage } from "@/components/setup/invoice-layout-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** §0.3 P3/P4, Settings → Invoice layout: the firm's own invoice (title, blocks, wording), previewed as the client prints it. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <InvoiceLayoutPage workspaceId={membership.workspaceId} />;
}
