import Link from "next/link";
import { GlobalApprovalTasks } from "@/components/projects/global-approval-tasks";
import { getAuthenticatedProfile } from "@/lib/auth/server";
import { getPreProjects } from "@/lib/pre-project/server";
import { projectRead } from "@/lib/projects/server";
import type { ApprovalQueuePage } from "../../../../../services/business-core/src/projects/project-approval-queue";
import styles from "./page.module.css";

const phaseLabels: Record<string, string> = {
  discover: "Requirements",
  define: "Scope",
  design: "Design",
  price: "Quotation",
  agree: "Agreement",
  release: "Release",
};

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ source?: string; page?: string }> }) {
  const profile = await getAuthenticatedProfile();
  const membership = profile.memberships[0];
  const owner = membership?.roles.some(role => role === "owner" || role === "administrator") ?? false;
  const canReviewCases = owner || Boolean(membership?.allowedModules.includes("pre-project"));
  const canReviewProjects = owner || Boolean(membership?.allowedModules.includes("projects"));
  const params = await searchParams;
  const requestedSource = params.source;
  const source = requestedSource === "projects" && canReviewProjects || !canReviewCases && canReviewProjects ? "projects" : "cases";
  const requestedPage = Number(params.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10000 ? requestedPage : 1;

  let caseContent: React.ReactNode = null;
  if (source === "cases" && canReviewCases) {
    const cases = await getPreProjects(new URLSearchParams({ page: String(page) }));
    const items = cases.items.filter(item => item.status !== "qualified" && item.status !== "cancelled" && !item.qualifiedLead);
    caseContent = <>
      {cases.error ? <p role="alert" className={styles.message}>{cases.error}</p> : null}
      {!cases.error && !items.length ? <div className={styles.empty}><strong>No case reviews to open</strong><p>Cases with design, quotation, agreement or Deal File decisions will appear here.</p></div> : null}
      {items.length ? <div className={styles.tableFrame}><table className={styles.table} aria-label="Case approval records"><thead><tr><th scope="col">Case</th><th scope="col">Client</th><th scope="col">Stage</th><th scope="col">Review</th></tr></thead><tbody>{items.map(item => <tr key={item.id}><th scope="row"><Link href={`/workspace/pre-projects/cases/${encodeURIComponent(item.id)}/approvals`}>{item.title}</Link></th><td>{item.customerName}</td><td>{phaseLabels[item.phase ?? ""] ?? "Planning"}</td><td><Link href={`/workspace/pre-projects/cases/${encodeURIComponent(item.id)}/approvals`}>Open approvals</Link></td></tr>)}</tbody></table></div> : null}
      {!cases.error && cases.total > 24 ? <nav className={styles.pagination} aria-label="Case pages">
        <span>Page {page} of {Math.ceil(cases.total / 24)}</span>
        {page > 1 ? <Link href={page === 2 ? "/workspace/approvals" : `/workspace/approvals?page=${page - 1}`}>Previous</Link> : null}
        {page * 24 < cases.total ? <Link href={`/workspace/approvals?page=${page + 1}`}>Next</Link> : null}
      </nav> : null}
    </>;
  }

  let projectContent: React.ReactNode = null;
  if (source === "projects" && canReviewProjects) {
    let initial: ApprovalQueuePage = { rows: [], nextCursor: null, memberId: "", canReview: false };
    let error = "";
    try {
      initial = (await projectRead<ApprovalQueuePage>("approvals?view=mine")).data;
    } catch {
      error = "Project approvals could not be loaded. Check your access or retry.";
    }
    projectContent = <GlobalApprovalTasks workspaceId={membership?.workspaceId ?? ""} initial={initial} initialError={error} embedded />;
  }

  return <div className={styles.page}>
    <header className={styles.header}><h1>Approvals</h1><p>Open client, Finance and Owner decisions for a case, or review a project request.</p></header>
    {canReviewCases || canReviewProjects ? <>
      <nav className={styles.tabs} aria-label="Approval sources">
        {canReviewCases ? <Link href="/workspace/approvals" aria-current={source === "cases" ? "page" : undefined}>Case decisions</Link> : null}
        {canReviewProjects ? <Link href="/workspace/approvals?source=projects" aria-current={source === "projects" ? "page" : undefined}>Project requests</Link> : null}
      </nav>
      <section className={styles.content} aria-label={source === "cases" ? "Case decisions" : "Project requests"}>
        {source === "cases" ? caseContent : projectContent}
      </section>
    </> : <p role="alert" className={styles.message}>You do not have access to case or project approvals.</p>}
  </div>;
}
