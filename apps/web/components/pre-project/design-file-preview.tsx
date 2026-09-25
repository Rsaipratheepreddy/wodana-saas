"use client";
import { useState } from "react";
import { FileImage, FileText, FileSpreadsheet, File, FileArchive } from "lucide-react";
import {
  caseApi,
  type CaseContent,
  type CaseDesign,
} from "@/lib/pre-project/content";
import view from "./designs.module.css";

export function FileCover({
  design,
  data,
  full = false,
}: {
  design: CaseDesign;
  data: CaseContent;
  full?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const asset = design.versions[0]?.asset;
  const extension = asset?.name.split('.').pop()?.toUpperCase() ?? 'FILE';
  const DocumentIcon = ['XLS', 'XLSX', 'CSV', 'ODS'].includes(extension) ? FileSpreadsheet : ['PDF', 'DOC', 'DOCX', 'ODT', 'TXT', 'RTF'].includes(extension) ? FileText : ['ZIP', 'RAR', '7Z'].includes(extension) ? FileArchive : asset?.mimeType.startsWith('image/') ? FileImage : File;
  const image = asset?.mimeType.startsWith("image/");
  const src = asset
    ? caseApi(
        data.workspaceId,
        data.caseId,
        `assets/${asset.id}${asset.hasPreview && (!full || !image) ? "?preview=1" : "?view=1"}`,
      )
    : "";
  return (
    <span className={view.cover}>
      {asset && (image || asset.hasPreview) && !failed ? (
        <>
          {!loaded && <small role="status">Loading preview…</small>}
          {/* Authenticated same-origin files retain the case access checks. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={full ? asset.name : ""}
            loading={full ? "eager" : "lazy"}
            src={src}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        <>
          <DocumentIcon size={36} />
          <small>{failed ? 'Preview unavailable' : asset ? extension : 'No file uploaded'}</small>
          {full && asset && (
            <a
              href={caseApi(
                data.workspaceId,
                data.caseId,
                `assets/${asset.id}?view=1`,
              )}
              target="_blank"
              rel="noreferrer"
            >
              Open original file ↗
            </a>
          )}
        </>
      )}
    </span>
  );
}
