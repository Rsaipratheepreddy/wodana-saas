"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, File, FileImage, FileText, RefreshCw } from "lucide-react";
import { Badge, Button, DataGrid, Callout, IconButton, SelectField, type DataGridColumn } from "@/design-system";
import type { LeadsPageData } from "@/lib/crm/leads";
import type { RequirementNote } from "@/lib/crm/note-document";
import type { CaseAsset } from "@/lib/pre-project/content";
import { crmRequest } from "@/lib/crm/client";
import { CrmProductShell } from "./crm-product-shell";
import styles from "./crm-attachments.module.css";

type Attachment = CaseAsset & { noteId: string; noteTitle: string };
function fileType(file: Attachment) {
  if (file.mimeType === "application/pdf") return "PDF";
  if (file.mimeType?.startsWith("image/")) return "Image";
  return file.name.split(".").length > 1 ? file.name.split(".").at(-1)!.toUpperCase() : "File";
}
function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function CrmAttachments({ initialData }: { initialData: LeadsPageData }) {
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
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Please try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [leadId, initialData.workspaceId, initialData.canView, revision]);
  const columns: DataGridColumn<Attachment>[] = [
    { accessorKey: "name", header: "File", size: 320, cell: ({ row }) => {
      const file = row.original;
      const Icon = file.mimeType?.startsWith("image/") ? FileImage : file.mimeType === "application/pdf" ? FileText : File;
      return <a className={styles.fileLink} href={`/api/workspace/requirement-notes/lead/${leadId}/${file.noteId}/assets/${file.id}?workspaceId=${encodeURIComponent(initialData.workspaceId)}`} target="_blank" rel="noopener noreferrer"><span className={styles.fileIcon} data-type={fileType(file)}><Icon size={18} aria-hidden="true" /></span><span className={styles.fileName}>{file.name}</span><ArrowUpRight size={13} aria-hidden="true" /></a>;
    } },
    { accessorKey: "noteTitle", header: "Requirement note", size: 240 },
    { id: "type", accessorFn: fileType, header: "Type", size: 100, cell: ({ row }) => <Badge tone="neutral">{fileType(row.original)}</Badge> },
    { accessorKey: "byteSize", header: "Size", size: 100, cell: ({ row }) => <span className={styles.size}>{fileSize(row.original.byteSize)}</span> },
  ];
  return <CrmProductShell title="Attachments" description="" canView={initialData.canView} useWorkspaceColors pageClassName={styles.page}>
    <div className={styles.contextBar}>
      <div className={styles.enquiryPicker}><SelectField aria-label="Choose enquiry" label={null} placeholder="Choose an enquiry" selectedKey={leadId || null} onSelectionChange={key => setLeadId(String(key ?? ""))} items={initialData.items.map(lead => ({ id: lead.id, label: `${lead.reference ? `${lead.reference} · ` : ""}${lead.title}`, description: lead.partyName }))} /></div>
      <span className={styles.summary}>{leadId ? loading ? "Loading files…" : `${files.length} ${files.length === 1 ? "file" : "files"}` : "Files from enquiry requirement notes"}</span>
      {leadId && <Link className={styles.manageLink} href={`/workspace/crm/leads?lead=${leadId}`}>Manage files <ArrowUpRight size={14} aria-hidden="true" /></Link>}
      <IconButton aria-label="Refresh attachments" size="compact" isDisabled={!leadId || loading} onPress={() => setRevision(value => value + 1)}><RefreshCw size={15} /></IconButton>
    </div>
    {error && <Callout title="Could not load attachments" tone="danger">{error}<Button size="compact" onPress={() => setRevision(value => value + 1)}>Retry</Button></Callout>}
    <DataGrid ariaLabel="Enquiry attachments" columns={columns} data={files} getRowId={file => `${file.noteId}:${file.id}`} isLoading={loading} searchLabel="Search files" rowNumbers={false} selectable={false} emptyTitle={error ? "Attachments unavailable" : leadId ? "No attachments yet" : "Choose an enquiry"} emptyDescription={error ? "Retry loading the files above." : leadId ? "Add files to this enquiry’s requirement notes using Manage files." : "Select an enquiry above to browse its documents and images."} />
  </CrmProductShell>;
}
