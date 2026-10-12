"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { HardHat } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import { siteApi, sitesToday } from "@/lib/site/client";
import type { SitesToday } from "@/lib/site/types";
import { useLiveInvalidate } from "@/lib/workspace/live-events";
import { DayCard } from "./day-card";
import styles from "./site-today-cards.module.css";

const SCOPES = ["projects"] as const;

/**
 * Home → My day for the site team: each running site I'm on today, with today's day card — or, when nobody has
 * reported yet, "Add today's report". Nothing shows for someone who isn't on a running site today.
 */
export function SiteTodayCards({ workspaceId }: { workspaceId: string }) {
  const t = useT();
  const [data, setData] = useState<SitesToday | null>(null);
  const load = useCallback(() => {
    sitesToday(workspaceId).then((value) => setData(Array.isArray(value?.sites) ? value : null), () => setData(null));
  }, [workspaceId]);
  useEffect(() => { queueMicrotask(load); }, [load]);
  useLiveInvalidate(workspaceId, SCOPES, load, 5_000);
  if (!data?.sites.length) return null;
  return <section className={styles.section} aria-labelledby="home-sites-today">
    <h2 id="home-sites-today" className={styles.title}>{t("Today on site")}</h2>
    <ul className={styles.list}>{data.sites.map((site) => {
      const href = `/workspace/projects/${site.projectId}/site`;
      return <li key={site.projectId} className={styles.site}>
        <div className={styles.head}>
          <Link className={styles.project} href={href}>{`${site.reference} · ${site.name}`}</Link>
          {!site.report || ["draft", "returned"].includes(site.report.status)
            ? <Link className="wd-button" data-size="compact" data-variant={site.report ? "secondary" : "primary"} href={`${href}?new=report`}>
              {site.report ? t("Continue") : t("Add today's report")}</Link> : null}
        </div>
        {site.card ? <DayCard card={site.card} projectId={site.projectId} photoUrl={siteApi(workspaceId, site.projectId).photoUrl} density="compact" href={`${href}?day=${site.card.date}`} />
          : <p className={styles.empty}><HardHat aria-hidden="true" size={14} />{data.dueTime ? t("No report yet · due by {time}", { time: data.dueTime }) : t("No report yet")}</p>}
      </li>;
    })}</ul>
  </section>;
}
