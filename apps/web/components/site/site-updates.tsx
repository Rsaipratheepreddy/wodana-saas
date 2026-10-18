"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { siteApi } from "@/lib/site/client";
import type { DayCard as DayCardData } from "@/lib/site/types";
import { DayCard } from "./day-card";
import styles from "./day-feed.module.css";

/**
 * The project's latest days on site as the same day cards the Site tab shows, compact (the Overview's "Site
 * updates"): each opens the whole card on the Site tab. Until they load (or if they can't), `fallback` shows.
 */
export function SiteUpdates({ workspaceId, projectId, latest = 3, fallback = null }: { workspaceId: string; projectId: string; latest?: number; fallback?: ReactNode }) {
  const api = useMemo(() => siteApi(workspaceId, projectId), [workspaceId, projectId]);
  const [cards, setCards] = useState<DayCardData[] | null>(null);
  useEffect(() => {
    let live = true;
    api.days({ latest }).then((feed) => { if (live && Array.isArray(feed?.cards)) setCards(feed.cards.slice(0, latest)); }, () => undefined);
    return () => { live = false; };
  }, [api, latest]);
  if (!cards?.length) return <>{fallback}</>;
  return <ol className={styles.compactList}>{cards.map((card) => <li key={card.date}>
    <DayCard card={card} projectId={projectId} photoUrl={api.photoUrl} density="compact" href={`/workspace/projects/${projectId}/site?day=${card.date}`} />
  </li>)}</ol>;
}
