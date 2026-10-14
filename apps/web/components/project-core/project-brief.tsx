"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { projectApi } from "@/lib/project-core/client";
import type { ChecklistGroupRead } from "@/lib/pre-project/design-workspace";
import { ChecklistAnswers } from "../pre-project/site-checklist";

/**
 * The job's brief from design, read-only: the client discovery answers by section, then each joinery checklist that
 * applies with its lines (confirmed, pending, not applicable) and their requirement or reference. Pending lines stand out.
 */
export function ProjectBrief({ workspaceId, projectId, version }: { workspaceId: string; projectId: string; version: number }) {
  const t = useT();
  const api = useMemo(() => projectApi(workspaceId), [workspaceId]);
  const [brief, setBrief] = useState<{ groups: ChecklistGroupRead[]; pending: number } | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setBrief(await api.brief(projectId)); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : t("The brief didn't load.")); }
  }, [api, projectId, t]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load, version]);

  if (error && !brief) return <ErrorState description={error} onRetry={() => void load()} />;
  if (!brief) return <Skeleton lines={6} shape="facts" />;
  if (!brief.groups.length) return <EmptyState illustration={null} title={t("No brief recorded")} description={t("The answers from the kick-off and the site measure show here.")} />;
  return <ChecklistAnswers groups={brief.groups} />;
}
