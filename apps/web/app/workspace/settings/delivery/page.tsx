import { redirect } from "next/navigation";
import { DeliveryHealthPage } from "@/components/workspace/delivery-health-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Connections → Delivery: whether email, WhatsApp and push reach people. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <DeliveryHealthPage workspaceId={membership.workspaceId} />;
}
