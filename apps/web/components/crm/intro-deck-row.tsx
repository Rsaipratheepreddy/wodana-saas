"use client";

import { useEffect, useState } from "react";
import { Download, Presentation } from "lucide-react";
import { FactRow } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { introDeckApi } from "@/lib/proposals/client";
import styles from "./opportunity-intro.module.css";

/**
 * PLM-106: the firm's intro deck, next to the intro meeting, and page 3 ("About your project") filled from this
 * opportunity's discovery answers as a PDF to bring to the meeting.
 */
export function IntroDeckRow({ workspaceId, opportunityId }: { workspaceId: string; opportunityId: string }) {
  const t = useT();
  const api = introDeckApi(workspaceId, opportunityId);
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    introDeckApi(workspaceId, opportunityId).get().then((result) => { if (alive) setUrl(result.url); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [workspaceId, opportunityId]);
  return <FactRow label={t("Intro deck")}>
    <span className={styles.deck}>
      {url ? <a href={url} target="_blank" rel="noreferrer"><Presentation aria-hidden="true" size={14} />{t("Open the deck")}</a> : url === null ? <span className={styles.empty}>{t("Add the deck link in Settings · Quotations")}</span> : null}
      <a href={api.pageUrl()} download><Download aria-hidden="true" size={14} />{t("About your project (PDF)")}</a>
    </span>
  </FactRow>;
}
