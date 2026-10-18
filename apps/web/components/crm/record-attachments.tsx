"use client";

import { FileText, Plus, RefreshCw } from "lucide-react";
import { Button, Callout, DataGrid, IconButton, useDesignSystem, type DataGridColumn } from "@/design-system";
import { useT } from "@/lib/i18n/i18n-provider";
import { translateKnown } from "@/lib/i18n/keys";
import { useRequirementNotes } from "./requirement-notes";
import type { CaseAsset } from "@/lib/pre-project/content";

type FileRow = CaseAsset & { noteId: string; noteTitle: string };

/** Keep files on their original enquiry so conversion never duplicates or loses them. */
export function RecordAttachments({ workspaceId, leadId }: { workspaceId: string; leadId: string }) {
  const t = useT();
  const { locale } = useDesignSystem();
  const notes = useRequirementNotes({ workspaceId, leadId });
  const files: FileRow[] = notes.items.filter(note => !note.archived).flatMap(note => (note.assets ?? []).map(asset => ({ ...asset, noteId: note.id, noteTitle: note.title })));
  const columns: DataGridColumn<FileRow>[] = [
    { accessorKey: "name", header: t("File"), size: 260, cell: ({ row: { original: file } }) => <a href={notes.fileUrl(file.noteId, file.id)} target="_blank" rel="noopener noreferrer"><FileText size={14} aria-hidden="true" /> {file.name}</a> },
    { accessorKey: "noteTitle", header: t("Requirement"), size: 200 },
    { id: "size", header: t("Size"), size: 90, accessorFn: file => file.byteSize < 1024 ? `${file.byteSize} B` : file.byteSize < 1048576 ? `${Math.round(file.byteSize / 1024)} KB` : `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(file.byteSize / 1048576)} MB` },
    { id: "manage", header: "", size: 100, cell: ({ row: { original: file } }) => <Button size="compact" onPress={() => { const entry = notes.entries.find(entry => entry.id === `requirement-note:${file.noteId}`); if (entry) notes.open(entry); }}>{t("View note")}</Button> },
  ];
  return <section aria-label={t("Record attachments")}>
    {notes.failure && <Callout tone="danger" title={t("Could not load attachments")}>{translateKnown(t, notes.failure)}</Callout>}
    <DataGrid ariaLabel={t("Attachments")} columns={columns} data={files} getRowId={file => `${file.noteId}:${file.id}`} isLoading={notes.loading} selectable={false} rowNumbers={false} searchLabel={t("Search attachments")} emptyTitle={t("No attachments yet")} emptyDescription={t("Files added to enquiry requirement notes appear here and stay linked to the opportunity.")} toolbarActions={<>{notes.canEdit && <Button size="compact" onPress={notes.add}><Plus size={14} />{t("Add files")}</Button>}<IconButton aria-label={t("Refresh attachments")} size="compact" onPress={notes.refresh}><RefreshCw size={14} /></IconButton></>} />
    {notes.editor}
  </section>;
}
