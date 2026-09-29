import { notFound, redirect } from "next/navigation";
import { AiActionPage } from "@/components/woddy/ai-action-page";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { UUID } from "@/lib/workspace/workspace-api";

/** A change an AI app prepared over MCP, for the person it acts as to confirm or cancel. */
export default async function Page({ params }: { params: Promise<{ toolCallId: string }> }) {
  const { toolCallId } = await params;
  if (!UUID.test(toolCallId)) notFound();
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  return <AiActionPage workspaceId={membership.workspaceId} toolCallId={toolCallId} />;
}
