"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDesignSystem } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { staffPortalApi } from "@/lib/client-portal/client";
import type { PortalFile, StaffThreads } from "@/lib/client-portal/types";
import styles from "./client-activity.module.css";

const NONE: PortalFile[] = [];

/** The client's side of a case's conversations: the files they added (per request and per message) and when they last read each thread. */
export function useClientThreads(workspaceId: string, caseId: string) {
  const t = useT();
  const api = useMemo(() => staffPortalApi(workspaceId, t), [workspaceId, t]);
  const [threads, setThreads] = useState<StaffThreads | null>(null);
  const load = useCallback(async () => {
    try { const next = await api.threads(caseId); if (next?.files && next.clientRead) setThreads(next); } catch { /* The conversation still shows without the client's files. */ }
  }, [api, caseId]);
  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  /** Someone on the team opened a thread: the client sees it was seen. */
  const markRead = useCallback((threadId: string) => { void api.readThread(caseId, threadId).catch(() => undefined); }, [api, caseId]);
  const files = useCallback((id: string) => threads?.files[id] ?? NONE, [threads]);
  const fileUrl = useCallback((assetId: string, preview = false) => api.clientFile(caseId, assetId, preview), [api, caseId]);
  return { files, fileUrl, clientRead: (threadId: string) => threads?.clientRead[threadId] ?? null, raisedBy: (threadId: string) => threads?.raisedBy?.[threadId] ?? null, markRead, load };
}

/**
 * Whether the client has seen the team's latest reply: "Seen by the client" with when, or "Not seen yet"
 * while a reply waits. Nothing before the team has replied and the client has opened it.
 */
export function SeenByClient({ readAt, lastReplyAt }: { readAt: string | null; lastReplyAt: string | null }) {
  const t = useT();
  const { locale, timeZone } = useDesignSystem();
  if (lastReplyAt && (!readAt || readAt < lastReplyAt)) return <p className={styles.muted}>{t("Not seen by the client yet")}</p>;
  if (!readAt) return null;
  const when = new Intl.DateTimeFormat(locale, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(readAt));
  return <p className={styles.muted}>{t("Seen by the client · {when}", { when })}</p>;
}
