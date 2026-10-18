"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, File, FileImage, FileText, RefreshCw } from "lucide-react";
import { Badge, DataGrid, EmptyState, ErrorState, IconButton, SelectField, type DataGridColumn } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import type { RequirementNote } from "@/lib/crm/note-document";
import type { CaseAsset } from "@/lib/pre-project/content";
import { crmRequest } from "@/lib/crm/client";
import { useT } from "@/lib/i18n/i18n-provider";
import type { Translate } from "@/lib/i18n/keys";
import { CrmProductShell } from "./crm-product-shell";
import styles from "./crm-attachments.module.css";

type Attachment = CaseAsset & { noteId: string; noteTitle: string };
function fileType(file: Attachment) {
  if (file.mimeType === "application/pdf") return "PDF";
  if (file.mimeType?.startsWith("image/")) return "Image";
  return file.name.split(".").length > 1 ? file.name.split(".").at(-1)!.toUpperCase() : "File";
}
function fileTypeLabel(file: Attachment, t: Translate) {
  const type = fileType(file);
  return type === "Image" ? t("Image") : type === "File" ? t("File") : type;
}
function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function CrmAttachments({ initialData }: { initialData: LeadsPageData }) {
  const t = useT();
  const [leadId, setLeadId] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setFiles([]); setError(""); setLoading(false);
    if (!leadId || !initialData.canView) return;
    const controller = new AbortController(); setLoading(true);
    crmRequest<{items: RequirementNote[]}>(initialData.workspaceId, `leads/${leadId}/requirement-notes`, "GET", undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setFiles(data.items.filter(note => !note.archived).flatMap(note => (note.assets ?? []).map(asset => ({ ...asset, noteId: note.id, noteTitle: note.title })))); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("Please try again.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [leadId, initialData.workspaceId, initialData.canView, revision, t]);
  const columns: DataGridColumn<Attachment>[] = [
    { accessorKey: "name", header: t("File"), size: 320, meta: { primary: true, interactive: true }, cell: ({ row }) => {
      const file = row.original;
      const Icon = file.mimeType?.startsWith("image/") ? FileImage : file.mimeType === "application/pdf" ? FileText : File;
      return <a className={styles.fileLink} href={`/api/workspace/requirement-notes/lead/${leadId}/${file.noteId}/assets/${file.id}?workspaceId=${encodeURIComponent(initialData.workspaceId)}`} target="_blank" rel="noopener noreferrer"><span className={styles.fileIcon} data-type={fileType(file)}><Icon size={18} aria-hidden="true" /></span><span className={styles.fileName}>{file.name}</span><ArrowUpRight size={13} aria-hidden="true" /></a>;
    } },
    { accessorKey: "noteTitle", header: t("Requirement note"), size: 240, meta: { priority: "medium" } },
    { id: "type", accessorFn: (file) => fileTypeLabel(file, t), header: t("Type"), size: 100, cell: ({ row }) => <Badge hue="auto">{fileTypeLabel(row.original, t)}</Badge> },
    { accessorKey: "byteSize", header: t("Size"), size: 100, meta: { align: "end" }, cell: ({ row }) => <span className={styles.size}>{fileSize(row.original.byteSize)}</span> },
  ];
  const retry = () => setRevision(value => value + 1);
  return <CrmProductShell title={t("Attachments")} canView={initialData.canView} useWorkspaceColors
    toolbar={<div className={styles.contextBar}>
      <div className={styles.enquiryPicker}><SelectField aria-label={t("Choose enquiry")} label={null} placeholder={t("Choose an enquiry")} selectedKey={leadId || null} onSelectionChange={key => setLeadId(String(key ?? ""))} items={initialData.items.map(lead => ({ id: lead.id, label: `${lead.reference ? `${lead.reference} · ` : ""}${lead.title}`, description: lead.partyName }))} /></div>
      {leadId && <Link className={styles.manageLink} href={`/workspace/crm/leads?lead=${leadId}`}>{t("Manage files")} <ArrowUpRight size={14} aria-hidden="true" /></Link>}
    </div>}>
    {error ? <ErrorState title={t("Could not load attachments")} description={error} onRetry={retry} />
      : <DataGrid ariaLabel={t("Enquiry attachments")} columns={columns} data={files} getRowId={file => `${file.noteId}:${file.id}`} isLoading={loading} searchLabel={t("Search files")} rowNumbers={false} selectable={false}
        emptyContent={leadId ? <EmptyState title={t("No attachments yet")} action={<Link className="wd-button" data-size="compact" data-variant="primary" href={`/workspace/crm/leads?lead=${leadId}`}>{t("Manage files")}</Link>} />
          : <EmptyState title={t("Choose an enquiry")} description={t("Select an enquiry above to browse its documents and images.")} />}
        footerActions={<IconButton aria-label={t("Refresh attachments")} size="compact" isDisabled={!leadId || loading} onPress={retry}><RefreshCw size={15} /></IconButton>} />}
  </CrmProductShell>;
}
