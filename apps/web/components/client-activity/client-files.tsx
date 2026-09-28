"use client";

import { FileText } from "lucide-react";
import { useT } from "@/lib/i18n/i18n-provider";
import type { PortalFile } from "@/lib/client-portal/types";
import styles from "./client-activity.module.css";

/** The photos and PDFs someone on the client's side added: photos as small previews, other files by name; each opens the original. */
export function ClientFiles({ files, url }: { files: PortalFile[]; url: (assetId: string, preview?: boolean) => string }) {
  const t = useT();
  if (!files.length) return null;
  return <ul className={styles.files} aria-label={t("Client files")}>{files.map((file) => {
    const picture = file.hasPreview || file.mimeType.startsWith("image/");
    return <li key={file.id}>
      {picture ? <a className={styles.thumb} href={url(file.id)} target="_blank" rel="noreferrer" aria-label={t("Open {name}", { name: file.name })}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a private file the client added, served only to the team */}
        <img src={url(file.id, file.hasPreview)} alt={file.name} loading="lazy" />
      </a> : <a className={styles.file} href={url(file.id)} target="_blank" rel="noreferrer">
        <FileText aria-hidden="true" size={14} /><span>{file.name}</span>
      </a>}
    </li>;
  })}</ul>;
}
