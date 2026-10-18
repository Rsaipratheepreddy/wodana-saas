import { redirect } from "next/navigation";
import { TeamChatPage } from "@/components/jobs/team-chat-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";

/** §0.3, Team chat: the team's own talk, one thread per job (the inbox is for the client's conversations). */
export default async function Page() {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <TeamChatPage workspaceId={membership.workspaceId} />;
}
