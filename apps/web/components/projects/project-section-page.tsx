import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { workspaceModules } from "@/components/workspace/workspace-navigation";
import { DEMO_PROJECT, demoProjectNavigation } from "@/lib/projects/demo";
import { changeRequestFlow, projectFlows, type ProjectSection } from "@/lib/projects/flows";
import styles from "./project-section-page.module.css";

export function ProjectSectionPage({ section, changeRequests = false }: { section: ProjectSection; changeRequests?: boolean }) {
  const commercial = section === "commercial";
  const showingChanges = commercial && changeRequests;
  const flow = showingChanges ? changeRequestFlow : projectFlows[section];
  const commercialHref = `${DEMO_PROJECT.root}/commercial`;
  const navigation = demoProjectNavigation(workspaceModules.find((module) => module.id === "projects")!.navigation).flatMap((group) => group.items);

  return <section className={styles.page} aria-label={`${projectFlows[section].title} project workspace`}>
    <header className={styles.header}>
      <h1>{projectFlows[section].title}</h1>
      <span className={styles.preview}>Workflow preview</span>
    </header>
    <p className={styles.summary}>{projectFlows[section].summary}</p>
    {commercial ? <nav className={styles.tabs} aria-label="Commercial sections">
      <Link href={commercialHref} aria-current={!showingChanges ? "page" : undefined}>Summary</Link>
      <Link href={`${commercialHref}?view=change-requests`} aria-current={showingChanges ? "page" : undefined}>Change requests</Link>
    </nav> : null}
    {showingChanges ? <div className={styles.subheading}><h2>Change requests</h2><p>{flow.summary}</p></div> : null}
    <div className={styles.context}><strong>Starts with</strong><p>{flow.receives}</p></div>
    <h2 className={styles.flowHeading}>How it flows</h2>
    <ol className={styles.steps} aria-label={`${flow.title} flow`}>
      {flow.steps.map((step, index) => <li key={step.title}>
        <span className={styles.number} aria-hidden="true">{index + 1}</span>
        <div><h3>{step.title}</h3><p>{step.detail}</p></div>
      </li>)}
    </ol>
    <div className={styles.context}><strong>Outcome</strong><p>{flow.outcome}</p></div>
    <p className={styles.note}>{flow.note}</p>
    {section === "overview" ? <nav className={styles.directory} aria-label="Project cycle">
      <h2>Project tabs</h2>
      {navigation.filter((item) => item.id !== "projects-overview").map((item) => <Link href={item.href} key={item.id}>
        <strong>{item.label}</strong><span>{item.description}</span><ArrowRight size={16} aria-hidden="true" data-directional="true" />
      </Link>)}
    </nav> : <nav className={styles.related} aria-label="Connected project tabs">
      <span>Connected tabs</span>
      {flow.related.map((id) => <Link href={`${DEMO_PROJECT.root}/${id}`} key={id}>{projectFlows[id].title}<ArrowRight size={14} aria-hidden="true" data-directional="true" /></Link>)}
    </nav>}
    <p className={styles.notice}>Demo project · These flows are planned. Operational records, approvals and accounting sync are not connected to this project yet.</p>
  </section>;
}
