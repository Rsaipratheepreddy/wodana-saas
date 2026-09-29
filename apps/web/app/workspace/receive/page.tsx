import { redirect } from "next/navigation";
import { ReceiveScan } from "@/components/purchasing/receive-scan";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/**
 * Receive on a phone (D-46): the code printed on an order or a move opens here (`?order=` or `?move=`). Receiving is
 * checked by the server for whoever receives goods, so the page isn't limited to Purchasing.
 */
export default async function Page() {
  const membership = (await getAuthenticatedProfile()).memberships[0];
  if (!membership) redirect("/login");
  return <ReceiveScan workspaceId={membership.workspaceId} />;
}
