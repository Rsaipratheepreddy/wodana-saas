"use client";

import { FileText, Plus, RefreshCw } from "lucide-react";
import { Button, Callout, DataGrid, IconButton, type DataGridColumn } from "@/design-system";
import { useRequirementNotes } from "./requirement-notes";
import type { CaseAsset } from "@/lib/pre-project/content";

type FileRow = CaseAsset & { noteId: string; noteTitle: string };

/** Keep files on their original enquiry so conversion never duplicates or loses them. */
export function RecordAttachments({ workspaceId, leadId }: { workspaceId: string; leadId: string }) {
  const notes = useRequirementNotes({ workspaceId, leadId });
  const files: FileRow[] = notes.items.filter(note => !note.archived).flatMap(note => (note.assets ?? []).map(asset => ({ ...asset, noteId: note.id, noteTitle: note.title })));
  const columns: DataGridColumn<FileRow>[] = [
    { accessorKey: "name", header: "File", size: 260, cell: ({ row: { original: file } }) => <a href={notes.fileUrl(file.noteId, file.id)} target="_blank" rel="noopener noreferrer"><FileText size={14} aria-hidden="true" /> {file.name}</a> },
    { accessorKey: "noteTitle", header: "Requirement", size: 200 },
    { id: "size", header: "Size", size: 90, accessorFn: file => file.byteSize < 1024 ? `${file.byteSize} B` : file.byteSize < 1048576 ? `${Math.round(file.byteSize / 1024)} KB` : `${(file.byteSize / 1048576).toFixed(1)} MB` },
    { id: "manage", header: "", size: 100, cell: ({ row: { original: file } }) => <Button size="compact" onPress={() => { const entry = notes.entries.find(entry => entry.id === `requirement-note:${file.noteId}`); if (entry) notes.open(entry); }}>View note</Button> },
  ];
  return <section aria-label="Record attachments">
    {notes.failure && <Callout tone="danger" title="Could not load attachments">{notes.failure}</Callout>}
    <DataGrid ariaLabel="Attachments" columns={columns} data={files} getRowId={file => `${file.noteId}:${file.id}`} isLoading={notes.loading} selectable={false} rowNumbers={false} searchLabel="Search attachments" emptyTitle="No attachments yet" emptyDescription="Files added to enquiry requirement notes appear here and stay linked to the opportunity." toolbarActions={<>{notes.canEdit && <Button size="compact" onPress={notes.add}><Plus size={14} />Add files</Button>}<IconButton aria-label="Refresh attachments" size="compact" onPress={notes.refresh}><RefreshCw size={14} /></IconButton></>} />
    {notes.editor}
  </section>;
}
