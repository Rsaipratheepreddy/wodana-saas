import Link from "next/link";
import { PageHeader } from "@/design-system";
import { WaitingForYouList } from "@/components/approvals/waiting-for-you";
import { GlobalApprovalTasks } from "@/components/projects/global-approval-tasks";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getWaitingForYou } from "@/lib/approvals/server";
import { getDesignQueue } from "@/lib/pre-project/server";
import { DesignQueue } from "@/components/pre-project/design-queue";
import { projectRead } from "@/lib/projects/server";
import type { ApprovalQueuePage } from "../../../../../services/business-core/src/projects/project-approval-queue";
import styles from "./page.module.css";
import { getServerT } from "@/lib/i18n/server";

type Source = "mine" | "designs" | "projects";

/**
 * Approvals: everything waiting for you across the modules first; design reviews and project requests
 * (RFAs and order amendments) keep their own queues beside it.
 */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const profile = await getAuthenticatedProfile();
  const t = await getServerT();
  const membership = profile.memberships[0];
  const owner = membership?.roles.some(role => role === "owner" || role === "administrator") ?? false;
  const canReviewCases = owner || Boolean(membership?.allowedModules.includes("pre-project"));
  const canReviewProjects = owner || Boolean(membership?.allowedModules.includes("projects"));
  const params = await searchParams;
  const source: Source = params.source === "designs" && canReviewCases ? "designs" : params.source === "projects" && canReviewProjects ? "projects" : "mine";
  const workspaceId = membership?.workspaceId ?? "";

  let content: React.ReactNode = null;
  if (source === "mine") {
    const waiting = await getWaitingForYou(workspaceId);
    content = <WaitingForYouList workspaceId={workspaceId} initial={waiting.data} initialError={waiting.failed ? t("What's waiting for you could not be loaded.") : undefined} />;
  } else if (source === "designs") {
    const queue = await getDesignQueue();
    content = <DesignQueue items={queue.items} error={queue.error} />;
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

  return <div className={styles.page}>
    <PageHeader title={t("Approvals")} />
    <nav className={styles.tabs} aria-label={t("Approval sources")}>
      <Link href="/workspace/approvals" aria-current={source === "mine" ? "page" : undefined}>{t("Waiting for you")}</Link>
      {canReviewCases ? <Link href="/workspace/approvals?source=designs" aria-current={source === "designs" ? "page" : undefined}>{t("Designs")}</Link> : null}
      {canReviewProjects ? <Link href="/workspace/approvals?source=projects" aria-current={source === "projects" ? "page" : undefined}>{t("Project requests")}</Link> : null}
    </nav>
    <section className={styles.content} aria-label={label}>{content}</section>
  </div>;
}
