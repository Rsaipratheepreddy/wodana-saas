"use client";

import { useState } from "react";
import { FileUploader, InlineNotice, ReviewFiles } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { evidenceFiles, uploadEvidence, type EvidenceFile, type EvidenceKind } from "@/lib/evidence/evidence";

/**
 * §0.3 P0: the photo or PDF behind a decision someone records (a bank transfer, a signed page, a client's message, a
 * count sheet). Each file uploads as it is chosen; the decision sends their ids and the server ties them to its record.
 */
export function EvidenceField({ workspaceId, kind, value, onChange, onBusy, label, isRequired = false }: {
  workspaceId: string; kind: EvidenceKind; value: EvidenceFile[]; onChange: (files: EvidenceFile[]) => void;
  /** True while a file is still uploading (the dialog waits before saving). */
  onBusy?: (busy: boolean) => void;
  label?: string; isRequired?: boolean;
}) {
  const t = useT();
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(0);
  const add = async (files: File[]) => {
    setError("");
    setUploading((count) => { onBusy?.(true); return count + files.length; });
    let next = value;
    for (const file of files) {
      try { next = [...next, await uploadEvidence(workspaceId, kind, file)]; onChange(next); }
      catch (cause) { setError(cause instanceof Error ? cause.message : t("The file could not be uploaded.")); }
      finally { setUploading((count) => { if (count <= 1) onBusy?.(false); return Math.max(0, count - 1); }); }
    }
  };
  const title = label ?? (isRequired ? t("Proof (photo or PDF)") : t("Proof (photo or PDF, optional)"));
  return <div className="wd-evidence-field">
    <ReviewFiles label={title} files={evidenceFiles(workspaceId, value)} onRemove={(id) => onChange(value.filter((file) => file.id !== id))} empty={null} />
    <FileUploader appearance="button" accept="image/*,application/pdf" label={uploading ? t("Uploading…") : value.length ? t("Add another") : t("Add a photo or PDF")}
      onFiles={(files) => void add(files.slice(0, Math.max(0, 10 - value.length)))} />
    {error ? <InlineNotice tone="error" message={error} /> : null}
  </div>;
}
