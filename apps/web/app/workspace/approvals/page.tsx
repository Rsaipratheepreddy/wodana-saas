import { PageShell } from "@/design-system";
import { WaitingForYouList } from "@/components/approvals/waiting-for-you";
import { GlobalApprovalTasks } from "@/components/projects/global-approval-tasks";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getWaitingForYou } from "@/lib/approvals/server";
import { getDesignQueue } from "@/lib/pre-project/server";
import { DesignQueue } from "@/components/pre-project/design-queue";
import { LiveRefresh } from "@/components/workspace/live-refresh";
import { projectRead } from "@/lib/projects/server";
import type { ApprovalQueuePage } from "../../../../../services/business-core/src/projects/project-approval-queue";
import { ApprovalTabs, type ApprovalSource } from "./approval-tabs";
import { getServerT } from "@/lib/i18n/server";

/**
 * Approvals: everything waiting for you across the modules first (a design sent to you for review too); the
 * design queue (reviews and the client's steps) and project requests (RFAs and order amendments) keep their own
 * queues beside it.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const profile = await getAuthenticatedProfile();
  const t = await getServerT();
  const membership = profile.memberships[0];
  const owner = membership?.roles.some(role => role === "owner" || role === "administrator") ?? false;
  const canReviewCases = owner || Boolean(membership?.allowedModules.includes("pre-project"));
  const canReviewProjects = owner || Boolean(membership?.allowedModules.includes("projects"));
  const params = await searchParams;
  const source: ApprovalSource = params.source === "designs" && canReviewCases ? "designs" : params.source === "projects" && canReviewProjects ? "projects" : "mine";
  const workspaceId = membership?.workspaceId ?? "";

  let content: React.ReactNode = null;
  if (source === "mine") {
    const waiting = await getWaitingForYou(workspaceId);
    content = <WaitingForYouList workspaceId={workspaceId} initial={waiting.data} initialError={waiting.failed ? t("What's waiting for you could not be loaded.") : undefined} />;
  } else if (source === "designs") {
    const queue = await getDesignQueue();
    // Design reviews are read on the server: a change in Planning re-renders them.
    content = <><DesignQueue items={queue.items} error={queue.error} /><LiveRefresh workspaceId={workspaceId} scopes={["planning", "approvals"]} /></>;
  } else {
    let initial: ApprovalQueuePage = { rows: [], nextCursor: null, memberId: "", canReview: false };
    let error = "";
    try {
      initial = (await projectRead<ApprovalQueuePage>("approvals?view=mine")).data;
    } catch {
      error = t("Project approvals could not be loaded. Check your access or retry.");
    }
    content = <GlobalApprovalTasks workspaceId={workspaceId} initial={initial} initialError={error} embedded />;
  }
  const label = source === "designs" ? t("Designs") : source === "projects" ? t("Project requests") : t("Waiting for you");

  return <PageShell title={t("Approvals")} tabs={canReviewCases || canReviewProjects
    ? <ApprovalTabs value={source} canReviewCases={canReviewCases} canReviewProjects={canReviewProjects} /> : undefined}>
    <section aria-label={label}>{content}</section>
  </PageShell>;
}
