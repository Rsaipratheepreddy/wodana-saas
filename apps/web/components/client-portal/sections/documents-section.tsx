"use client";

import { FileImage, FileText } from "lucide-react";
import { EmptyState } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import styles from "../portal.module.css";
import type { SectionProps } from "./section-types";

/** The files published to the client: the signed agreement, approved designs and handover packs. */
export function DocumentsSection({ project, api, format }: SectionProps) {
  const t = useT();
  const documents = project.documents;
  if (!documents) return null;
  if (!documents.length) return <EmptyState illustration="upload" title={t("No documents yet")} description={t("Your agreement, approved designs and handover pack will appear here.")} />;
  const kinds = { agreement: t("Agreement"), design: t("Approved designs"), handover: t("Handover") };
  return <div className={styles.section}>
    {(["agreement", "design", "handover"] as const).map((kind) => {
      const items = documents.filter((document) => document.kind === kind);
      return items.length ? <section className={styles.group} key={kind} aria-label={kinds[kind]}>
        <h2 className={styles.groupTitle}>{kinds[kind]}</h2>
        <ul className={styles.list}>{items.map((document) => <li className={styles.item} key={`${kind}-${document.id}`}>
          <a className={styles.itemText} href={api.file(kind, document.id)} rel="noreferrer" target="_blank">
            <span className={styles.fileName}>{document.mimeType.startsWith("image/") ? <FileImage aria-hidden="true" size={16} /> : <FileText aria-hidden="true" size={16} />} {document.title}</span>
            <span className={styles.itemMeta}>{[document.group, format.date(document.date)].filter(Boolean).join(" · ")}</span>
          </a>
        </li>)}</ul>
      </section> : null;
    })}
  </div>;
}
