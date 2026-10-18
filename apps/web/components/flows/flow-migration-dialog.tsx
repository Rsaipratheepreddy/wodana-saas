"use client";

import { useEffect, useState } from "react";
import { Checkbox, FormDialog, InlineNotice, Skeleton } from "@/design-system";
import { crmRequest } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./steps-table.module.css";

type Job = {
  opportunityId: string; reference: string; title: string; owner: string | null; fromVersion: number;
  nowBefore: { key: string; name: string } | null; nowAfter: { key: string; name: string } | null;
  newlyMissing: Array<{ key: string; label: string; stepKey: string }>; dropped: Array<{ key: string; name: string }>;
};
type Preview = { toVersion: number; jobs: Job[]; truncated: boolean };

/**
 * E2-3: running jobs keep the version of the steps they started on. Moving them to the latest version is explicit:
 * the preview shows, per job, where it stands now and after, what it would now also need, and the steps it drops.
 */
export function FlowMigrationDialog({ workspaceId, flowId, typeName, onClose, onMoved }: { workspaceId: string; flowId: string; typeName: string; onClose: () => void; onMoved: (count: number) => void }) {
  const t = useT();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [failure, setFailure] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  useEffect(() => {
    const controller = new AbortController();
    crmRequest<Preview>(workspaceId, `flows/${flowId}/migration`, "GET", undefined, controller.signal)
      .then((next) => { setPreview(next); setChosen(new Set(next.jobs.map((job) => job.opportunityId))); })
      .catch((cause: Error) => { if (!controller.signal.aborted) setFailure(cause.message); });
    return () => controller.abort();
  }, [workspaceId, flowId]);
  const toggle = (id: string, on: boolean) => setChosen((current) => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
  return <FormDialog size="lg" title={preview ? t("Move jobs to version {version}", { version: preview.toVersion }) : t("Move jobs to the new version")} description={typeName}
    submitLabel={t("Move {count} jobs", { count: chosen.size })} error={failure || undefined} isSubmitDisabled={!preview || !chosen.size} onClose={onClose}
    onSubmit={async () => {
      const result = await crmRequest<{ moved: string[] }>(workspaceId, `flows/${flowId}/migration`, "POST", { toVersion: preview!.toVersion, opportunityIds: [...chosen] });
      onMoved(result.moved.length);
    }}>
    {!preview ? (failure ? null : <Skeleton lines={4} shape="form" />) : !preview.jobs.length ? <InlineNotice message={t("Every running job is on the latest version.")} />
      : <ul aria-label={t("Running jobs")} className={styles.jobs}>{preview.jobs.map((job) => <li className={styles.job} key={job.opportunityId}>
        <Checkbox isSelected={chosen.has(job.opportunityId)} onChange={(on) => toggle(job.opportunityId, on)}>
          <span className={styles.jobTitle}><strong>{job.reference}</strong> {job.title}</span>
        </Checkbox>
        <span className={styles.jobMeta}>{t("Version {version}", { version: job.fromVersion })}{job.owner ? ` · ${job.owner}` : ""}</span>
        <span className={styles.jobMeta}>{t("Now: {before} → {after}", { before: job.nowBefore?.name ?? "—", after: job.nowAfter?.name ?? "—" })}</span>
        {job.newlyMissing.length ? <span className={styles.jobWarn}>{t("Also needs: {items}", { items: job.newlyMissing.map((item) => item.label).join(", ") })}</span> : null}
        {job.dropped.length ? <span className={styles.jobMeta}>{t("No longer a step: {items}", { items: job.dropped.map((item) => item.name).join(", ") })}</span> : null}
      </li>)}</ul>}
  </FormDialog>;
}
