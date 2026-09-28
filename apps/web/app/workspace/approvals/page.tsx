import Link from "next/link";
import { GlobalApprovalTasks } from "@/components/projects/global-approval-tasks";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getDesignQueue } from "@/lib/pre-project/server";
import { DesignQueue } from "@/components/pre-project/design-queue";
import { LiveRefresh } from "@/components/workspace/live-refresh";
import { projectRead } from "@/lib/projects/server";
import type { ApprovalQueuePage } from "../../../../../services/business-core/src/projects/project-approval-queue";
import styles from "./page.module.css";
import { getServerT } from "@/lib/i18n/server";


export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const profile = await getAuthenticatedProfile();
  const t = await getServerT();
  const membership = profile.memberships[0];
  const owner = membership?.roles.some(role => role === "owner" || role === "administrator") ?? false;
  const canReviewCases = owner || Boolean(membership?.allowedModules.includes("pre-project"));
  const canReviewProjects = owner || Boolean(membership?.allowedModules.includes("projects"));
  const params = await searchParams;
  const requestedSource = params.source;
  const source = requestedSource === "projects" && canReviewProjects || !canReviewCases && canReviewProjects ? "projects" : "cases";

  let caseContent: React.ReactNode = null;
  if (source === "cases" && canReviewCases) {
    const queue = await getDesignQueue();
    // Design reviews are read on the server: a change in Planning re-renders them.
    caseContent = <><DesignQueue items={queue.items} error={queue.error} /><LiveRefresh workspaceId={membership?.workspaceId ?? ""} scopes={["planning", "approvals"]} /></>;
  }

  let projectContent: React.ReactNode = null;
  if (source === "projects" && canReviewProjects) {
    let initial: ApprovalQueuePage = { rows: [], nextCursor: null, memberId: "", canReview: false };
    let error = "";
    try {
      initial = (await projectRead<ApprovalQueuePage>("approvals?view=mine")).data;
    } catch {
      error = t("Project approvals could not be loaded. Check your access or retry.");
    }
    projectContent = <GlobalApprovalTasks workspaceId={membership?.workspaceId ?? ""} initial={initial} initialError={error} embedded />;
  }

  return <div className={styles.page}>
    <h1 className={styles.visuallyHidden}>{t("Approvals")}</h1>
    {canReviewCases || canReviewProjects ? <>
      <nav className={styles.tabs} aria-label={t("Approval sources")}>
        {canReviewCases ? <Link href="/workspace/approvals" aria-current={source === "cases" ? "page" : undefined}>{t("Designs")}</Link> : null}
        {canReviewProjects ? <Link href="/workspace/approvals?source=projects" aria-current={source === "projects" ? "page" : undefined}>{t("Project requests")}</Link> : null}
      </nav>
      <section className={styles.content} aria-label={source === "cases" ? t("Designs") : t("Project requests")}>
        {source === "cases" ? caseContent : projectContent}
      </section>
    </> : <p role="alert" className={styles.message}>{t("You do not have access to case or project approvals.")}</p>}
  </div>;
}
