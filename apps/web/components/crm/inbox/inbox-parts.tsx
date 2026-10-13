"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { crmRequest } from "@/lib/crm/client";
import { waitingMinutes, waitingParts, type ClosingSettings, type InboxLabel, type InboxOwner, type InboxSettings, type InboxTemplate, type QuickReply } from "@/lib/crm/inbox";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "./inbox-parts.module.css";

export function LabelChip({ label }: { label: Pick<InboxLabel, "name" | "color"> }) {
  return <span className={styles.label} data-color={label.color} title={label.name}>{label.name}</span>;
}

/** "Waiting 42 m": how long the client has waited for our reply; red after an hour. */
export function WaitChip({ since, now }: { since: unknown; now: number }) {
  const t = useT();
  const minutes = waitingMinutes(since, now);
  if (minutes === null) return null;
  const { key, count } = waitingParts(minutes);
  return <span className={styles.wait} data-level={minutes >= 60 ? "late" : undefined}><Clock3 aria-hidden="true" size={11} />{t(key, { count })}</span>;
}

/** A timer that re-renders every `ms` so waits and the WhatsApp window stay current. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(timer); }, [ms]);
  return now;
}

type Lookups = { labels: InboxLabel[]; owners: InboxOwner[]; quickReplies: QuickReply[]; settings: InboxSettings | null; templates: InboxTemplate[]; closing: ClosingSettings | null };
const EMPTY: Lookups = { labels: [], owners: [], quickReplies: [], settings: null, templates: [], closing: null };

/** The inbox's workspace lists (labels, people, quick replies, settings, templates), loaded once and reloadable. */
export function useInboxLookups(workspaceId: string) {
  const [lookups, setLookups] = useState<Lookups>(EMPTY);
  const [failure, setFailure] = useState("");
  const reload = useCallback(async () => {
    const read = <T,>(path: string, fallback: T) => crmRequest<T>(workspaceId, path).catch((error: Error & { status?: number }) => { if (error.status !== 403) setFailure(error.message); return fallback; });
    const [labels, owners, quickReplies, settings, templates, closing] = await Promise.all([
      read<InboxLabel[]>("inbox/labels", []), read<InboxOwner[]>("inbox/owners", []), read<QuickReply[]>("inbox/quick-replies", []),
      read<InboxSettings | null>("inbox/settings", null), read<InboxTemplate[]>("inbox/templates", []), read<ClosingSettings | null>("inbox/closing-messages", null),
    ]);
    const list = <T,>(value: T[] | unknown) => (Array.isArray(value) ? value : []) as T[];
    setLookups({ labels: list<InboxLabel>(labels), owners: list<InboxOwner>(owners), quickReplies: list<QuickReply>(quickReplies), settings: settings && typeof settings === "object" && "workday" in settings ? settings : null, templates: list<InboxTemplate>(templates),
      closing: closing && typeof closing === "object" && Array.isArray(closing.messages) ? closing : null });
  }, [workspaceId]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);
  return { ...lookups, failure, reload };
}
