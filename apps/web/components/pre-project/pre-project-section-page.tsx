import type { WorkspaceNavigationItem } from "@/components/workspace/workspace-navigation";
import styles from "./pre-project-section-page.module.css";

export function PreProjectSectionPage({ section }: { section: WorkspaceNavigationItem }) {
  return (
    <section aria-labelledby="pre-project-section-title" className={styles.page}>
      <header className={styles.header}>
        <h1 id="pre-project-section-title">{section.label}</h1>
        <span className={styles.status}>Planned</span>
      </header>
      <p className={styles.description}>{section.description}</p>
      <div className={styles.notice}>
        <h2>Section ready to plan</h2>
        <p>
          The navigation is in place. Forms, records, and workflow actions for
          this section are not available yet.
        </p>
      </div>
    </section>
  );
}
