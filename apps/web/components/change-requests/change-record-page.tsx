"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorState, PageSkeleton } from "@/design-system";
import { QuoteBuilder } from "@/components/quotation/quote-builder";
import { ProjectVariation } from "@/components/project-core/project-variation";
import { useWorkspaceBreadcrumb } from "@/components/workspace/workspace-breadcrumb";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import { ChangeRequestError, projectChangesApi, type ChangeRecord as Record_ } from "@/lib/change-requests/project";
import { ChangeRecord } from "./change-record";
import styles from "./project-changes.module.css";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A change's record; an address from before (a variation quotation's id) opens that variation in the builder. */
export function ChangeRecordPage({ workspaceId, projectId, changeId }: { workspaceId: string; projectId: string; changeId: string }) {
  const t = useT();
  const api = useMemo(() => projectChangesApi(workspaceId, projectId), [workspaceId, projectId]);
  const [state, setState] = useState<{ record: Record_ } | { legacy: true } | { error: string } | null>(UUID.test(changeId) ? null : { legacy: true });
  useEffect(() => {
    if (!UUID.test(changeId)) return;
    let alive = true;
    api.get(changeId).then((record) => { if (alive) setState({ record }); })
      .catch((cause: Error) => { if (alive) setState(cause instanceof ChangeRequestError && cause.status === 404 ? { legacy: true } : { error: cause.message || t("The change didn't load.") }); });
    return () => { alive = false; };
  }, [api, changeId, t]);
  if (!state) return <div className={styles.page}><PageSkeleton variant="detail" tabs={5} /></div>;
  if ("legacy" in state) return <ProjectVariation workspaceId={workspaceId} projectId={projectId} quoteId={changeId} />;
  if ("error" in state) return <div className={styles.page}><ErrorState description={state.error} /></div>;
  return <ChangeRecord workspaceId={workspaceId} projectId={projectId} changeId={changeId} initial={state.record} />;
}

/** The change's variation in the quotation builder: priced line by line with the shared engine; back goes to the change. */
export function ChangePricePage({ workspaceId, projectId, changeId }: { workspaceId: string; projectId: string; changeId: string }) {
  const t = useT();
  const [target, setTarget] = useState<{ caseId: string; quoteId: string; name: string } | null>(null);
  const [error, setError] = useState("");
  useWorkspaceBreadcrumb(target?.name);
  useEffect(() => {
    let alive = true;
    Promise.all([projectApi(workspaceId).get(projectId), projectChangesApi(workspaceId, projectId).get(changeId)]).then(([detail, record]) => {
      if (!alive) return;
      if (!record.change.quoteId) setError(t("This change isn't priced yet."));
      else setTarget({ caseId: detail.project.caseId, quoteId: record.change.quoteId, name: detail.project.name });
    }).catch((cause: Error) => { if (alive) setError(cause.message); });
    return () => { alive = false; };
  }, [workspaceId, projectId, changeId, t]);
  if (error) return <div className={styles.page}><ErrorState description={error} /></div>;
  if (!target) return <div className={styles.page}><PageSkeleton variant="detail" /></div>;
  return <QuoteBuilder key={target.quoteId} workspaceId={workspaceId} caseId={target.caseId} quoteId={target.quoteId}
    backHref={`/workspace/projects/${projectId}/changes/${changeId}?tab=price`} quoteHref={() => `/workspace/projects/${projectId}/changes/${changeId}/price`} />;
}
