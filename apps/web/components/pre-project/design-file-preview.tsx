"use client";
import { useState } from "react";
import { FileImage, FileText } from "lucide-react";
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
          {asset?.mimeType === "application/pdf" ? (
            <FileText size={36} />
          ) : (
            <FileImage size={36} />
          )}
          <small>
            {failed
              ? "Preview unavailable"
              : asset?.mimeType === "application/pdf"
                ? "PDF"
                : asset
                  ? "Preview not available for this file type"
                  : "No file uploaded"}
          </small>
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
