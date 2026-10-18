"use client";

import { useEffect, useState } from "react";
import { ErrorState, PageSkeleton } from "@/design-system";
import { QuoteBuilder } from "@/components/quotation/quote-builder";
import { useWorkspaceBreadcrumb } from "@/components/workspace/workspace-breadcrumb";
import { projectApi } from "@/lib/project-core/client";
import styles from "./project-core.module.css";

/** Opens a project's variation in the quotation builder, with the project as its way back. */
export function ProjectVariation({ workspaceId, projectId, quoteId }: { workspaceId: string; projectId: string; quoteId: string }) {
  const [project, setProject] = useState<{ caseId: string; name: string } | null>(null);
  const [error, setError] = useState("");
  useWorkspaceBreadcrumb(project?.name);
  useEffect(() => {
    let alive = true;
    projectApi(workspaceId).get(projectId).then((detail) => { if (alive) setProject({ caseId: detail.project.caseId, name: detail.project.name }); })
      .catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId, projectId]);
  if (error) return <div className={styles.page}><ErrorState description={error} /></div>;
  if (!project) return <div className={styles.page}><PageSkeleton variant="detail" /></div>;
  return <div className={styles.builderPage}>
    <QuoteBuilder key={quoteId} workspaceId={workspaceId} caseId={project.caseId} quoteId={quoteId}
      backHref={`/workspace/projects/${projectId}/scope`} quoteHref={(id) => `/workspace/projects/${projectId}/changes/${id}`} />
  </div>;
}
