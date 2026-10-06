"use client";

import { Download, Eye, FileImage, FileText } from "lucide-react";
import { Badge, EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalDocument } from "@/lib/client-portal/types";
import styles from "../portal-home.module.css";
import type { SectionProps } from "./section-types";

/**
 * The files published to the client as document cards (§5b, E5-4): a preview when there is one, the title, its type,
 * version and date, a "Changed" marker when it replaced a version the client had (the old one stays in history), and
 * View / Download. Never a bare link.
 */
export function DocumentsSection({ project, api, format }: SectionProps) {
  const t = useT();
  const documents = project.documents;
  if (!documents) return null;
  if (!documents.length) return <EmptyState illustration="upload" title={t("No documents yet")} description={t("Your agreement, approved designs and handover pack will appear here.")} />;
  const kinds: Record<PortalDocument["kind"], string> = { agreement: t("Agreement"), design: t("Approved design"), handover: t("Handover"), change: t("Signed change") };
  const sorted = [...documents].sort((a, b) => (b.at ?? b.date ?? "").localeCompare(a.at ?? a.date ?? ""));
  return <ul className={styles.documents} aria-label={t("Documents")}>{sorted.map((document) => {
    const url = api.file(document.kind, document.id);
    return <li className={styles.document} key={`${document.kind}-${document.id}`}>
      <span className={styles.preview} aria-hidden="true">{document.hasPreview
        // eslint-disable-next-line @next/next/no-img-element -- a private file streamed through the portal's signed-in route
        ? <img alt="" loading="lazy" src={api.file(document.kind, document.id, true)} />
        : document.mimeType.startsWith("image/") ? <FileImage size={32} /> : <FileText size={32} />}</span>
      <span className={styles.documentBody}>
        <span className={styles.cardTitle} dir="auto">{document.title}</span>
        <span className={styles.chips}>
          <Badge>{kinds[document.kind]}</Badge>
          {document.version ? <Badge>{t("V{number}", { number: document.version })}</Badge> : null}
          {document.changed ? <Badge tone="warning">{t("Changed")}</Badge> : null}
        </span>
        <span className={styles.cardNote}>{[document.group, format.date(document.date)].filter(Boolean).join(" · ")}</span>
      </span>
      <span className={styles.documentActions}>
        <a className={styles.action} href={url} rel="noreferrer" target="_blank"><Eye aria-hidden="true" size={14} />{t("View")}</a>
        <a className={styles.action} href={url} download><Download aria-hidden="true" size={14} />{t("Download")}</a>
      </span>
    </li>;
  })}</ul>;
}
