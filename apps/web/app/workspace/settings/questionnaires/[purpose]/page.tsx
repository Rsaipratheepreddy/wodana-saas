import { notFound, redirect } from "next/navigation";
import { QuestionnaireEditor } from "@/components/setup/questionnaire-editor";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { isQuestionnairePurpose } from "@/lib/setup/questionnaires";

/** §0.3 P3: one questionnaire's questions, its draft and its published versions. */
export default async function Page({ params }: { params: Promise<{ purpose: string }> }) {
  const [{ purpose }, profile] = await Promise.all([params, getAuthenticatedProfile()]);
  const membership = profile.memberships[0];
  if (!membership) redirect("/login");
  if (!isQuestionnairePurpose(purpose)) notFound();
  return <QuestionnaireEditor workspaceId={membership.workspaceId} purpose={purpose} />;
}
