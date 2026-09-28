import { redirect } from "next/navigation";
import { InboxSettingsPage } from "@/components/crm/inbox/inbox-settings";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** Settings → Inbox: the one WhatsApp number, how new chats are assigned, the signature, labels, quick replies and template variables. */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <InboxSettingsPage workspaceId={membership.workspaceId} />;
}
